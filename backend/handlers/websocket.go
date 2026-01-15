package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/websocket/v2"
	"github.com/google/uuid"
	"localai/database"
	"localai/services"
)

type ClientMessage struct {
	Type           string   `json:"type"`
	Content        string   `json:"content,omitempty"`
	MentionedModels []string `json:"mentioned_models,omitempty"`
}

type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (sc *SafeConn) WriteJSON(v interface{}) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.conn.WriteJSON(v)
}

func (sc *SafeConn) ReadJSON(v interface{}) error {
	return sc.conn.ReadJSON(v)
}

func (sc *SafeConn) Close() error {
	return sc.conn.Close()
}

var (
	orchestrators = make(map[string]*services.Orchestrator)
	orchMu        sync.RWMutex
)

func WebSocketHandler(c *websocket.Conn) {
	sessionID := c.Params("sessionId")
	log.Printf("WebSocket connected for session: %s", sessionID)

	sc := &SafeConn{conn: c}

	var session database.Session
	err := database.DB.QueryRow(`
		SELECT id, name, model_configs, autonomy_rounds FROM sessions WHERE id = ?
	`, sessionID).Scan(&session.ID, &session.Name, &session.ModelConfigs, &session.AutonomyRounds)

	if err != nil {
		sc.WriteJSON(services.StreamMessage{Type: "error", Error: "Session not found"})
		sc.Close()
		return
	}

	var modelConfigs []database.ModelConfig
	json.Unmarshal([]byte(session.ModelConfigs), &modelConfigs)
	modelConfigs = normalizeModelConfigs(modelConfigs)

	orch := services.NewOrchestrator(sessionID, modelConfigs, session.AutonomyRounds)

	rows, _ := database.DB.Query(`
		SELECT id, session_id, role, model_id, model_name, content, round_number, tokens_used, created_at
		FROM messages WHERE session_id = ? ORDER BY created_at
	`, sessionID)
	if rows != nil {
		var messages []database.Message
		for rows.Next() {
			var m database.Message
			rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.ModelID, &m.ModelName, &m.Content, &m.RoundNumber, &m.TokensUsed, &m.CreatedAt)
			messages = append(messages, m)
		}
		rows.Close()
		orch.LoadHistory(messages)
	}

	orchMu.Lock()
	orchestrators[sessionID] = orch
	orchMu.Unlock()

	defer func() {
		orchMu.Lock()
		delete(orchestrators, sessionID)
		orchMu.Unlock()
		sc.Close()
	}()

	sc.WriteJSON(services.StreamMessage{Type: "ready"})

	for {
		var msg ClientMessage
		if err := sc.ReadJSON(&msg); err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		switch msg.Type {
		case "user_message":
			go handleUserMessage(sc, orch, sessionID, msg.Content, msg.MentionedModels)

		case "pause":
			orch.Pause()
			sc.WriteJSON(services.StreamMessage{Type: "paused"})

		case "resume":
			orch.Resume()
			sc.WriteJSON(services.StreamMessage{Type: "resumed"})

		case "stop":
			orch.Stop()
			sc.WriteJSON(services.StreamMessage{Type: "stopped"})

		case "update_config":
			var configsJSON string
			var rounds int
			database.DB.QueryRow("SELECT model_configs, autonomy_rounds FROM sessions WHERE id = ?", sessionID).Scan(&configsJSON, &rounds)
			var configs []database.ModelConfig
			json.Unmarshal([]byte(configsJSON), &configs)
			configs = normalizeModelConfigs(configs)
			orch.ModelConfigs = configs
			orch.AutonomyRounds = rounds
		}
	}
}

func handleUserMessage(sc *SafeConn, orch *services.Orchestrator, sessionID, content string, mentionedModels []string) {
	orch.Reset()

	userMsgID := uuid.New().String()
	now := time.Now()
	database.DB.Exec(`
		INSERT INTO messages (id, session_id, role, content, round_number, tokens_used, created_at)
		VALUES (?, ?, 'user', ?, 0, 0, ?)
	`, userMsgID, sessionID, content, now)

	userMsg := database.Message{
		ID:        userMsgID,
		SessionID: sessionID,
		Role:      "user",
		Content:   content,
		CreatedAt: now,
	}
	orch.AddToHistory(userMsg)

	sc.WriteJSON(services.StreamMessage{Type: "round_start", Round: 0})

	contentMentions := services.ExtractMentionsFromUserMessage(content, orch.ModelConfigs)
	allMentions := append(mentionedModels, contentMentions...)
	respondingModels := orch.GetRespondingModels(allMentions, content)
	cleanContent := services.StripMentions(content)

	processModelResponses(sc, orch, sessionID, respondingModels, cleanContent, 0)

	sc.WriteJSON(services.StreamMessage{Type: "round_end", Round: 0})

	if orch.AutonomyRounds > 0 && len(orch.ModelConfigs) >= 2 && !orch.IsStopped() {
		for round := 1; round <= orch.AutonomyRounds && !orch.IsStopped(); round++ {
			sc.WriteJSON(services.StreamMessage{Type: "round_start", Round: round})

			for _, model := range orch.ModelConfigs {
				if orch.IsStopped() {
					break
				}

				for orch.IsPaused() && !orch.IsStopped() {
					time.Sleep(100 * time.Millisecond)
				}

				generateModelResponseWithReturn(sc, orch, sessionID, model, "", round)
			}

			sc.WriteJSON(services.StreamMessage{Type: "round_end", Round: round})
		}
	}

	tokenUsage := make(map[string]int)
	for _, m := range orch.ModelConfigs {
		tokenUsage[m.Name] = 0
	}
	for _, msg := range orch.History {
		if msg.ModelName != nil {
			tokenUsage[*msg.ModelName] += msg.TokensUsed
		}
	}
	sc.WriteJSON(map[string]interface{}{
		"type":  "token_usage",
		"usage": tokenUsage,
	})
}

func processModelResponses(sc *SafeConn, orch *services.Orchestrator, sessionID string, models []database.ModelConfig, prompt string, round int) {
	for _, model := range models {
		if orch.IsStopped() {
			break
		}

		for orch.IsPaused() && !orch.IsStopped() {
			time.Sleep(100 * time.Millisecond)
		}

		generateModelResponseWithReturn(sc, orch, sessionID, model, prompt, round)
	}
}

func generateModelResponseWithReturn(sc *SafeConn, orch *services.Orchestrator, sessionID string, model database.ModelConfig, prompt string, round int) string {
	if orch.IsStopped() {
		return ""
	}

	sc.WriteJSON(services.StreamMessage{
		Type:      "thinking",
		ModelID:   model.ShortID,
		ModelName: model.Name,
		Color:     model.Color,
	})

	messages := orch.BuildChatMessages(model, prompt)

	var fullResponse string
	var totalTokens int
	startTime := time.Now()

	var chunkBuffer string
	var bufferMu sync.Mutex
	var lastFlush time.Time = time.Now()
	flushInterval := 25 * time.Millisecond

	flushBuffer := func(force bool) {
		bufferMu.Lock()
		defer bufferMu.Unlock()

		if chunkBuffer == "" {
			return
		}

		if !force && time.Since(lastFlush) < flushInterval {
			return
		}

		elapsed := time.Since(startTime).Seconds()
		var tokensPerSecond float64
		if elapsed > 0 && totalTokens > 0 {
			tokensPerSecond = float64(totalTokens) / elapsed
		}

		sc.WriteJSON(services.StreamMessage{
			Type:            "chunk",
			ModelID:         model.ShortID,
			ModelName:       model.Name,
			Content:         chunkBuffer,
			Tokens:          totalTokens,
			TokensPerSecond: tokensPerSecond,
			Color:           model.Color,
		})

		chunkBuffer = ""
		lastFlush = time.Now()
	}

	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			if orch.IsStopped() {
				return
			}
			flushBuffer(false)
		}
	}()

	err := services.StreamChatToProvider(orch.Context(), model.ModelID, messages, func(chunk string, done bool, tokens int) {
		if orch.IsStopped() {
			return
		}

		for orch.IsPaused() && !orch.IsStopped() {
			time.Sleep(100 * time.Millisecond)
		}

		bufferMu.Lock()
		fullResponse += chunk
		chunkBuffer += chunk
		totalTokens = tokens
		bufferMu.Unlock()

		if done {
			flushBuffer(true)
		}
	})

	// If stopped or error but we have partial content, still save it
	wasStopped := orch.IsStopped()
	if err != nil && fullResponse == "" {
		// Log raw error for debugging
		log.Printf("API error for %s: %s", model.ModelID, err.Error())
		// Parse the error and provide helpful guidance
		errorMsg := parseAPIError(err.Error(), model.ModelID)
		sc.WriteJSON(services.StreamMessage{
			Type:      "error",
			ModelID:   model.ShortID,
			ModelName: model.Name,
			Error:     errorMsg,
		})
		return ""
	}

	if wasStopped && fullResponse != "" {
		fullResponse += "\n\n*[Response stopped by user]*"
	}

	msgID := uuid.New().String()
	now := time.Now()
	database.DB.Exec(`
		INSERT INTO messages (id, session_id, role, model_id, model_name, content, round_number, tokens_used, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, msgID, sessionID, model.ShortID, model.ShortID, model.Name, fullResponse, round, totalTokens, now)

	modelID := model.ShortID
	modelName := model.Name
	orch.AddToHistory(database.Message{
		ID:          msgID,
		SessionID:   sessionID,
		Role:        model.ShortID,
		ModelID:     &modelID,
		ModelName:   &modelName,
		Content:     fullResponse,
		RoundNumber: round,
		TokensUsed:  totalTokens,
		CreatedAt:   now,
	})

	sc.WriteJSON(services.StreamMessage{
		Type:      "complete",
		ModelID:   model.ShortID,
		ModelName: model.Name,
		Content:   fullResponse,
		Tokens:    totalTokens,
		Color:     model.Color,
	})

	return fullResponse
}

func parseAPIError(errMsg string, modelID string) string {
	provider := "the provider"
	if strings.HasPrefix(modelID, "anthropic:") {
		provider = "Anthropic"
	} else if strings.HasPrefix(modelID, "gemini:") {
		provider = "Google Gemini"
	} else if strings.HasPrefix(modelID, "openai:") {
		provider = "OpenAI"
	} else if strings.HasPrefix(modelID, "groq:") {
		provider = "Groq"
	} else if strings.HasPrefix(modelID, "deepseek:") {
		provider = "DeepSeek"
	} else if strings.HasPrefix(modelID, "together:") {
		provider = "Together AI"
	} else if strings.HasPrefix(modelID, "openrouter:") {
		provider = "OpenRouter"
	}

	errLower := strings.ToLower(errMsg)

	if strings.Contains(errLower, "quota") || strings.Contains(errLower, "429") {
		if strings.Contains(errLower, "limit: 0") || strings.Contains(errLower, "limit\":0") {
			return fmt.Sprintf("🚫 This model has no free tier access on %s. Try a different model (e.g., gemini-2.0-flash) or enable billing.", provider)
		}
		return fmt.Sprintf("⏱️ Quota exceeded for %s. You've hit usage limits - wait a bit or check your plan.", provider)
	}
	if strings.Contains(errLower, "rate") && strings.Contains(errLower, "limit") {
		return fmt.Sprintf("⏱️ Rate limit reached for %s. Please wait a moment before trying again.", provider)
	}

	if strings.Contains(errLower, "credit") && (strings.Contains(errLower, "balance") || strings.Contains(errLower, "low")) {
		return fmt.Sprintf("💳 %s requires credits. Please add credits at the provider's billing page.", provider)
	}

	if strings.Contains(errLower, "invalid") && (strings.Contains(errLower, "key") || strings.Contains(errLower, "api")) {
		return fmt.Sprintf("🔑 Invalid API key for %s. Please check your API key in Settings and make sure it's correct.", provider)
	}
	if strings.Contains(errLower, "unauthorized") || strings.Contains(errLower, "authentication") || strings.Contains(errLower, "401") {
		return fmt.Sprintf("🔑 Authentication failed for %s. Please verify your API key in Settings.", provider)
	}

	if strings.Contains(errLower, "not found") || strings.Contains(errLower, "404") || strings.Contains(errLower, "does not exist") {
		return fmt.Sprintf("❌ Model not found. The model '%s' may have been deprecated or renamed. Try selecting a different model.", modelID)
	}

	if strings.Contains(errLower, "connection") || strings.Contains(errLower, "timeout") || strings.Contains(errLower, "network") {
		return fmt.Sprintf("🌐 Connection error with %s. Please check your internet connection and try again.", provider)
	}

	if strings.Contains(errLower, "context canceled") {
		return "Stopped by user."
	}

	return fmt.Sprintf("%s error: %s", provider, errMsg)
}
