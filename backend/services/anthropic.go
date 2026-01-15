package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type AnthropicProvider struct {
	apiKey string
}

var AnthropicModels = []string{
	"claude-sonnet-4-20250514",
	"claude-opus-4-20250514",
	"claude-3-5-sonnet-20241022",
	"claude-3-5-haiku-20241022",
	"claude-3-opus-20240229",
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{apiKey: apiKey}
}

func RegisterAnthropicProvider(apiKey string) {
	provider := NewAnthropicProvider(apiKey)
	Providers.Register(provider)
}

func ValidateAnthropicKey(apiKey string) error {
	reqBody := map[string]interface{}{
		"model":      "claude-3-5-haiku-20241022",
		"max_tokens": 1,
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
	}

	jsonBody, _ := json.Marshal(reqBody)
	req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewBuffer(jsonBody))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to Anthropic: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return fmt.Errorf("invalid API key")
	}
	if resp.StatusCode == 403 {
		return fmt.Errorf("API key does not have permission")
	}
	if resp.StatusCode != 200 && resp.StatusCode != 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(body))
	}

	return nil
}

func (p *AnthropicProvider) Name() string {
	return "anthropic"
}

func (p *AnthropicProvider) SupportsModel(modelID string) bool {
	if strings.HasPrefix(modelID, "anthropic:") {
		return true
	}
	for _, m := range AnthropicModels {
		if m == modelID {
			return true
		}
	}
	return false
}

func (p *AnthropicProvider) ListModels() ([]Model, error) {
	models := make([]Model, len(AnthropicModels))
	for i, m := range AnthropicModels {
		models[i] = Model{
			ID:       "anthropic:" + m,
			Name:     m,
			Provider: "anthropic",
		}
	}
	return models, nil
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	Stream    bool               `json:"stream"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicStreamEvent struct {
	Type  string `json:"type"`
	Index int    `json:"index,omitempty"`
	Delta *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"delta,omitempty"`
	ContentBlock *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content_block,omitempty"`
	Message *struct {
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	} `json:"message,omitempty"`
	Usage *struct {
		OutputTokens int `json:"output_tokens"`
	} `json:"usage,omitempty"`
}

func (p *AnthropicProvider) StreamChat(ctx context.Context, model string, messages []ChatMessage, onChunk func(string, bool, int)) error {
	if strings.HasPrefix(model, "anthropic:") {
		model = strings.TrimPrefix(model, "anthropic:")
	}

	var systemPrompt string
	var anthropicMessages []anthropicMessage

	for _, m := range messages {
		if m.Role == "system" {
			systemPrompt = m.Content
		} else {
			anthropicMessages = append(anthropicMessages, anthropicMessage{
				Role:    m.Role,
				Content: m.Content,
			})
		}
	}

	reqBody := anthropicRequest{
		Model:     model,
		MaxTokens: 4096,
		System:    systemPrompt,
		Messages:  anthropicMessages,
		Stream:    true,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.anthropic.com/v1/messages", bytes.NewBuffer(jsonBody))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", p.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("failed to connect to Anthropic: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Anthropic API error (%d): %s", resp.StatusCode, string(body))
	}

	reader := bufio.NewReader(resp.Body)
	totalTokens := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}

		lineStr := strings.TrimSpace(string(line))
		if lineStr == "" || !strings.HasPrefix(lineStr, "data: ") {
			continue
		}

		jsonData := strings.TrimPrefix(lineStr, "data: ")
		if jsonData == "[DONE]" {
			onChunk("", true, totalTokens)
			break
		}

		var event anthropicStreamEvent
		if err := json.Unmarshal([]byte(jsonData), &event); err != nil {
			continue
		}

		switch event.Type {
		case "content_block_delta":
			if event.Delta != nil && event.Delta.Text != "" {
				onChunk(event.Delta.Text, false, totalTokens)
			}
		case "message_delta":
			if event.Usage != nil {
				totalTokens = event.Usage.OutputTokens
			}
		case "message_stop":
			onChunk("", true, totalTokens)
			return nil
		}
	}

	return nil
}
