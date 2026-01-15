package handlers

import (
	"encoding/json"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"localai/database"
)

type CreateSessionRequest struct {
	Name           string                  `json:"name"`
	ModelConfigs   []database.ModelConfig  `json:"model_configs"`
	AutonomyRounds int                     `json:"autonomy_rounds"`
}

type UpdateSessionRequest struct {
	Name           *string                 `json:"name,omitempty"`
	ModelConfigs   []database.ModelConfig  `json:"model_configs,omitempty"`
	AutonomyRounds *int                    `json:"autonomy_rounds,omitempty"`
}

type SessionResponse struct {
	ID             string                  `json:"id"`
	Name           string                  `json:"name"`
	ModelConfigs   []database.ModelConfig  `json:"model_configs"`
	AutonomyRounds int                     `json:"autonomy_rounds"`
	CreatedAt      time.Time               `json:"created_at"`
	UpdatedAt      time.Time               `json:"updated_at"`
}

type SessionWithMessages struct {
	SessionResponse
	Messages []database.Message `json:"messages"`
}

func normalizeModelConfigs(configs []database.ModelConfig) []database.ModelConfig {
	for i := range configs {
		if configs[i].Role == "" {
			configs[i].Role = database.RoleGeneral
		}
	}
	return configs
}

func ListSessions(c *fiber.Ctx) error {
	rows, err := database.DB.Query(`
		SELECT id, name, model_configs, autonomy_rounds, created_at, updated_at
		FROM sessions
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var sessions []SessionResponse
	for rows.Next() {
		var s database.Session
		if err := rows.Scan(&s.ID, &s.Name, &s.ModelConfigs, &s.AutonomyRounds, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}

		var configs []database.ModelConfig
		json.Unmarshal([]byte(s.ModelConfigs), &configs)
		configs = normalizeModelConfigs(configs)

		sessions = append(sessions, SessionResponse{
			ID:             s.ID,
			Name:           s.Name,
			ModelConfigs:   configs,
			AutonomyRounds: s.AutonomyRounds,
			CreatedAt:      s.CreatedAt,
			UpdatedAt:      s.UpdatedAt,
		})
	}

	if sessions == nil {
		sessions = []SessionResponse{}
	}

	return c.JSON(sessions)
}

func CreateSession(c *fiber.Ctx) error {
	var req CreateSessionRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Name == "" {
		req.Name = "New Session"
	}
	if req.AutonomyRounds < 0 {
		req.AutonomyRounds = 0
	}
	if req.AutonomyRounds > 999 {
		req.AutonomyRounds = 999
	}

	req.ModelConfigs = normalizeModelConfigs(req.ModelConfigs)

	id := uuid.New().String()
	configsJSON, _ := json.Marshal(req.ModelConfigs)
	now := time.Now()

	_, err := database.DB.Exec(`
		INSERT INTO sessions (id, name, model_configs, autonomy_rounds, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, req.Name, string(configsJSON), req.AutonomyRounds, now, now)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(SessionResponse{
		ID:             id,
		Name:           req.Name,
		ModelConfigs:   req.ModelConfigs,
		AutonomyRounds: req.AutonomyRounds,
		CreatedAt:      now,
		UpdatedAt:      now,
	})
}

func GetSession(c *fiber.Ctx) error {
	id := c.Params("id")

	var s database.Session
	err := database.DB.QueryRow(`
		SELECT id, name, model_configs, autonomy_rounds, created_at, updated_at
		FROM sessions WHERE id = ?
	`, id).Scan(&s.ID, &s.Name, &s.ModelConfigs, &s.AutonomyRounds, &s.CreatedAt, &s.UpdatedAt)

	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Session not found"})
	}

	var configs []database.ModelConfig
	json.Unmarshal([]byte(s.ModelConfigs), &configs)
	configs = normalizeModelConfigs(configs)

	rows, err := database.DB.Query(`
		SELECT id, session_id, role, model_id, model_name, content, round_number, tokens_used, created_at
		FROM messages WHERE session_id = ? ORDER BY created_at
	`, id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var messages []database.Message
	for rows.Next() {
		var m database.Message
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.ModelID, &m.ModelName, &m.Content, &m.RoundNumber, &m.TokensUsed, &m.CreatedAt); err != nil {
			continue
		}
		messages = append(messages, m)
	}

	if messages == nil {
		messages = []database.Message{}
	}

	return c.JSON(SessionWithMessages{
		SessionResponse: SessionResponse{
			ID:             s.ID,
			Name:           s.Name,
			ModelConfigs:   configs,
			AutonomyRounds: s.AutonomyRounds,
			CreatedAt:      s.CreatedAt,
			UpdatedAt:      s.UpdatedAt,
		},
		Messages: messages,
	})
}

func UpdateSession(c *fiber.Ctx) error {
	id := c.Params("id")

	var req UpdateSessionRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	var exists bool
	database.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?)", id).Scan(&exists)
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Session not found"})
	}

	now := time.Now()

	if req.Name != nil {
		database.DB.Exec("UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?", *req.Name, now, id)
	}
	if req.ModelConfigs != nil {
		req.ModelConfigs = normalizeModelConfigs(req.ModelConfigs)
		configsJSON, _ := json.Marshal(req.ModelConfigs)
		database.DB.Exec("UPDATE sessions SET model_configs = ?, updated_at = ? WHERE id = ?", string(configsJSON), now, id)
	}
	if req.AutonomyRounds != nil {
		rounds := *req.AutonomyRounds
		if rounds < 1 {
			rounds = 1
		}
		if rounds > 999 {
			rounds = 999
		}
		database.DB.Exec("UPDATE sessions SET autonomy_rounds = ?, updated_at = ? WHERE id = ?", rounds, now, id)
	}

	return GetSession(c)
}

func DeleteSession(c *fiber.Ctx) error {
	id := c.Params("id")

	database.DB.Exec("DELETE FROM messages WHERE session_id = ?", id)

	result, err := database.DB.Exec("DELETE FROM sessions WHERE id = ?", id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Session not found"})
	}

	return c.JSON(fiber.Map{"status": "deleted"})
}
