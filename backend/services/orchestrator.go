package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"localai/database"
)

type Orchestrator struct {
	SessionID      string
	ModelConfigs   []database.ModelConfig
	AutonomyRounds int
	History        []database.Message
	mu             sync.Mutex
	stopRequested  bool
	pauseRequested bool
	ctx            context.Context
	cancel         context.CancelFunc
}

type StreamMessage struct {
	Type            string  `json:"type"`
	ModelID         string  `json:"model_id,omitempty"`
	ModelName       string  `json:"model_name,omitempty"`
	Content         string  `json:"content,omitempty"`
	Tokens          int     `json:"tokens,omitempty"`
	TokensPerSecond float64 `json:"tokens_per_second,omitempty"`
	Round           int     `json:"round,omitempty"`
	Error           string  `json:"error,omitempty"`
	Color           string  `json:"color,omitempty"`
}

func NewOrchestrator(sessionID string, configs []database.ModelConfig, rounds int) *Orchestrator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Orchestrator{
		SessionID:      sessionID,
		ModelConfigs:   configs,
		AutonomyRounds: rounds,
		History:        make([]database.Message, 0),
		ctx:            ctx,
		cancel:         cancel,
	}
}

func (o *Orchestrator) Context() context.Context {
	return o.ctx
}

func (o *Orchestrator) Stop() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.stopRequested = true
	o.cancel()
}

func (o *Orchestrator) Reset() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.stopRequested = false
	o.pauseRequested = false
	o.ctx, o.cancel = context.WithCancel(context.Background())
}

func (o *Orchestrator) Pause() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.pauseRequested = true
}

func (o *Orchestrator) Resume() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.pauseRequested = false
}

func (o *Orchestrator) IsStopped() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.stopRequested
}

func (o *Orchestrator) IsPaused() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.pauseRequested
}

func StripMentions(content string) string {
	re := regexp.MustCompile(`@\[[^\]]+\]\s*`)
	return strings.TrimSpace(re.ReplaceAllString(content, ""))
}

func ExtractMentionsFromUserMessage(content string, configs []database.ModelConfig) []string {
	var mentioned []string

	if strings.Contains(strings.ToLower(content), "@all") {
		mentioned = append(mentioned, "all")
	}

	re1 := regexp.MustCompile(`@\[([^\]]+)\]`)
	matches1 := re1.FindAllStringSubmatch(content, -1)
	for _, match := range matches1 {
		if len(match) > 1 {
			mentioned = append(mentioned, match[1])
		}
	}

	re2 := regexp.MustCompile(`@([\w.-]+)`)
	matches2 := re2.FindAllStringSubmatch(content, -1)
	for _, match := range matches2 {
		if len(match) > 1 && strings.ToLower(match[1]) != "all" {
			mentioned = append(mentioned, match[1])
		}
	}

	seen := make(map[string]bool)
	var unique []string
	for _, m := range mentioned {
		lower := strings.ToLower(m)
		if !seen[lower] {
			seen[lower] = true
			unique = append(unique, m)
		}
	}

	return unique
}

func ClassifyTask(content string) string {
	contentLower := strings.ToLower(content)

	planningKeywords := []string{
		"plan", "planning", "brainstorm", "ideas", "think about",
		"design", "architect", "strategy", "approach", "outline",
		"what should", "how should", "let's discuss", "think through",
		"consider", "propose", "suggest", "recommendation",
	}

	codingKeywords := []string{
		"code", "coding", "implement", "write", "build", "create",
		"function", "class", "method", "api", "endpoint", "database",
		"fix bug", "debug", "refactor", "program", "script", "develop",
		"html", "css", "javascript", "python", "go", "swift", "react",
	}

	reviewKeywords := []string{
		"review", "check", "analyze", "evaluate", "assess",
		"feedback", "improve", "optimize", "critique", "look at",
		"what's wrong", "find issues", "bugs in",
	}

	planningScore := 0
	codingScore := 0
	reviewScore := 0

	for _, kw := range planningKeywords {
		if strings.Contains(contentLower, kw) {
			planningScore++
		}
	}

	for _, kw := range codingKeywords {
		if strings.Contains(contentLower, kw) {
			codingScore++
		}
	}

	for _, kw := range reviewKeywords {
		if strings.Contains(contentLower, kw) {
			reviewScore++
		}
	}

	if planningScore > codingScore && planningScore > reviewScore && planningScore > 0 {
		return database.RolePlanner
	}
	if codingScore > planningScore && codingScore > reviewScore && codingScore > 0 {
		return database.RoleCoder
	}
	if reviewScore > planningScore && reviewScore > codingScore && reviewScore > 0 {
		return database.RoleReviewer
	}

	return database.RoleGeneral
}

func (o *Orchestrator) GetRespondingModels(mentionedModels []string, userMessage string) []database.ModelConfig {
	if len(o.ModelConfigs) == 0 {
		return o.ModelConfigs
	}

	for _, mentioned := range mentionedModels {
		if strings.EqualFold(mentioned, "all") {
			return o.ModelConfigs
		}
	}

	if len(mentionedModels) > 0 {
		var responding []database.ModelConfig
		for _, config := range o.ModelConfigs {
			for _, mentioned := range mentionedModels {
				if strings.EqualFold(config.ShortID, mentioned) || strings.EqualFold(config.Name, mentioned) {
					responding = append(responding, config)
					break
				}
			}
		}
		if len(responding) > 0 {
			return responding
		}
	}

	taskRole := ClassifyTask(userMessage)

	for _, config := range o.ModelConfigs {
		if config.Role == taskRole {
			return []database.ModelConfig{config}
		}
	}

	for _, config := range o.ModelConfigs {
		if config.Role == database.RoleGeneral {
			return []database.ModelConfig{config}
		}
	}

	return []database.ModelConfig{o.ModelConfigs[0]}
}

func (o *Orchestrator) BuildSystemPrompt(forModel database.ModelConfig) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("Your name is %s.", forModel.Name))

	if forModel.SystemPrompt != "" {
		sb.WriteString(" ")
		sb.WriteString(forModel.SystemPrompt)
	}

	sb.WriteString("\n\nRules:\n")
	sb.WriteString("- Only discuss what the user actually said. Do not invent or assume topics.\n")
	sb.WriteString("- Do not pretend to have had previous conversations that didn't happen.\n")
	sb.WriteString("- Do not claim capabilities you don't have (like browsing the web, generating images, or executing code).\n")
	sb.WriteString("- You are a text-based assistant. You can only provide text responses.\n")
	sb.WriteString("- If you don't know something, say so.\n")

	if len(o.ModelConfigs) > 1 {
		sb.WriteString("\n## Multi-Agent Collaboration\n")
		sb.WriteString("You are in a multi-agent chat with other AI assistants. ")
		sb.WriteString("Messages from other assistants appear as [AssistantName (#id)]: content.\n")
		sb.WriteString("- You CAN see and reference what other assistants have said.\n")
		sb.WriteString("- You CAN build upon, improve, or respectfully critique their work.\n")
		sb.WriteString("- IMPORTANT: Only respond if you have something NEW and valuable to add.\n")
		sb.WriteString("- Do NOT repeat what others have said or just echo agreement.\n")
		sb.WriteString("- For simple greetings/questions, ONE brief response is enough - don't keep chatting about being ready to help.\n")
		sb.WriteString("- Focus on the actual task. If there's no task yet, wait for one instead of making small talk.\n")
		sb.WriteString("- If another assistant has already answered well, say 'I agree with [name]' or stay silent rather than repeating.\n")
	}

	sb.WriteString("\nUse markdown code blocks with language tags when sharing code.")

	return sb.String()
}

func (o *Orchestrator) BuildChatMessages(forModel database.ModelConfig, currentPrompt string) []ChatMessage {
	var messages []ChatMessage

	systemPrompt := o.BuildSystemPrompt(forModel)
	messages = append(messages, ChatMessage{
		Role:    "system",
		Content: systemPrompt,
	})

	for _, msg := range o.History {
		cleanContent := StripMentions(msg.Content)

		if msg.Role == "user" {
			messages = append(messages, ChatMessage{
				Role:    "user",
				Content: cleanContent,
			})
		} else if msg.ModelID != nil && *msg.ModelID == forModel.ShortID {
			messages = append(messages, ChatMessage{
				Role:    "assistant",
				Content: cleanContent,
			})
		} else if msg.ModelName != nil {
			messages = append(messages, ChatMessage{
				Role:    "user",
				Content: fmt.Sprintf("[%s (#%s)]: %s", *msg.ModelName, *msg.ModelID, cleanContent),
			})
		}
	}

	if currentPrompt != "" && currentPrompt != o.getLastUserMessage() {
		messages = append(messages, ChatMessage{
			Role:    "user",
			Content: currentPrompt,
		})
	}

	return messages
}

func (o *Orchestrator) getLastUserMessage() string {
	for i := len(o.History) - 1; i >= 0; i-- {
		if o.History[i].Role == "user" {
			return StripMentions(o.History[i].Content)
		}
	}
	return ""
}

func (o *Orchestrator) AddToHistory(msg database.Message) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.History = append(o.History, msg)
}

func (o *Orchestrator) LoadHistory(messages []database.Message) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.History = messages
}

func SerializeMessage(msg StreamMessage) ([]byte, error) {
	return json.Marshal(msg)
}
