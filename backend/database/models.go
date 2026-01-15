package database

import "time"

type Session struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	ModelConfigs  string    `json:"model_configs"`
	AutonomyRounds int      `json:"autonomy_rounds"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Message struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"session_id"`
	Role        string    `json:"role"`
	ModelID     *string   `json:"model_id"`
	ModelName   *string   `json:"model_name"`
	Content     string    `json:"content"`
	RoundNumber int       `json:"round_number"`
	TokensUsed  int       `json:"tokens_used"`
	CreatedAt   time.Time `json:"created_at"`
}

type ModelConfig struct {
	ModelID      string `json:"model_id"`
	Name         string `json:"name"`
	ShortID      string `json:"short_id"`
	SystemPrompt string `json:"system_prompt"`
	Color        string `json:"color"`
	Role         string `json:"role"`
}

const (
	RolePlanner  = "planner"
	RoleCoder    = "coder"
	RoleReviewer = "reviewer"
	RoleGeneral  = "general"
)

type ProviderKey struct {
	Provider  string    `json:"provider"`
	APIKey    string    `json:"api_key"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func SaveProviderKey(provider, apiKey string) error {
	_, err := DB.Exec(`
		INSERT INTO provider_keys (provider, api_key, enabled, updated_at)
		VALUES (?, ?, 1, CURRENT_TIMESTAMP)
		ON CONFLICT(provider) DO UPDATE SET
			api_key = excluded.api_key,
			enabled = 1,
			updated_at = CURRENT_TIMESTAMP
	`, provider, apiKey)
	return err
}

func GetProviderKey(provider string) (*ProviderKey, error) {
	var pk ProviderKey
	var enabled int
	err := DB.QueryRow(`
		SELECT provider, api_key, enabled, created_at, updated_at
		FROM provider_keys WHERE provider = ?
	`, provider).Scan(&pk.Provider, &pk.APIKey, &enabled, &pk.CreatedAt, &pk.UpdatedAt)
	if err != nil {
		return nil, err
	}
	pk.Enabled = enabled == 1
	return &pk, nil
}

func GetAllProviderKeys() ([]ProviderKey, error) {
	rows, err := DB.Query(`
		SELECT provider, api_key, enabled, created_at, updated_at
		FROM provider_keys ORDER BY provider
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []ProviderKey
	for rows.Next() {
		var pk ProviderKey
		var enabled int
		if err := rows.Scan(&pk.Provider, &pk.APIKey, &enabled, &pk.CreatedAt, &pk.UpdatedAt); err != nil {
			continue
		}
		pk.Enabled = enabled == 1
		keys = append(keys, pk)
	}
	return keys, nil
}

func DeleteProviderKey(provider string) error {
	_, err := DB.Exec(`DELETE FROM provider_keys WHERE provider = ?`, provider)
	return err
}

func SetProviderEnabled(provider string, enabled bool) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	_, err := DB.Exec(`UPDATE provider_keys SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ?`, enabledInt, provider)
	return err
}
