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

type OpenAIProvider struct {
	name    string
	baseURL string
	apiKey  string
	models  []string
}

var OpenAIProviderConfigs = map[string]struct {
	BaseURL string
	Models  []string
}{
	"openai": {
		BaseURL: "https://api.openai.com/v1",
		Models:  []string{"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"},
	},
	"deepseek": {
		BaseURL: "https://api.deepseek.com",
		Models:  []string{"deepseek-chat", "deepseek-coder"},
	},
	"groq": {
		BaseURL: "https://api.groq.com/openai/v1",
		Models:  []string{"llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"},
	},
	"together": {
		BaseURL: "https://api.together.xyz/v1",
		Models:  []string{"meta-llama/Llama-3.3-70B-Instruct-Turbo", "meta-llama/Llama-3.2-3B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"},
	},
	"openrouter": {
		BaseURL: "https://openrouter.ai/api/v1",
		Models:  []string{"openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-pro-1.5", "meta-llama/llama-3.3-70b-instruct"},
	},
}

func NewOpenAIProvider(name, baseURL, apiKey string, models []string) *OpenAIProvider {
	return &OpenAIProvider{
		name:    name,
		baseURL: baseURL,
		apiKey:  apiKey,
		models:  models,
	}
}

func RegisterOpenAIProvider(name, apiKey string) {
	config, ok := OpenAIProviderConfigs[name]
	if !ok {
		return
	}
	provider := NewOpenAIProvider(name, config.BaseURL, apiKey, config.Models)
	Providers.Register(provider)
}

func ValidateOpenAIKey(name, apiKey string) error {
	config, ok := OpenAIProviderConfigs[name]
	if !ok {
		return fmt.Errorf("unknown provider: %s", name)
	}

	req, err := http.NewRequest("GET", config.BaseURL+"/models", nil)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to %s: %w", name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return fmt.Errorf("invalid API key")
	}
	if resp.StatusCode == 403 {
		return fmt.Errorf("API key does not have permission")
	}
	if resp.StatusCode != 200 && resp.StatusCode != 404 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(body))
	}

	return nil
}

func (p *OpenAIProvider) Name() string {
	return p.name
}

func (p *OpenAIProvider) SupportsModel(modelID string) bool {
	prefix := p.name + ":"
	if strings.HasPrefix(modelID, prefix) {
		return true
	}

	for _, m := range p.models {
		if m == modelID {
			return true
		}
	}
	return false
}

func (p *OpenAIProvider) ListModels() ([]Model, error) {
	models := make([]Model, len(p.models))
	for i, m := range p.models {
		models[i] = Model{
			ID:       p.name + ":" + m,
			Name:     m,
			Provider: p.name,
		}
	}
	return models, nil
}

type openAIChatRequest struct {
	Model    string              `json:"model"`
	Messages []openAIChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
}

type openAIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIStreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
}

func (p *OpenAIProvider) StreamChat(ctx context.Context, model string, messages []ChatMessage, onChunk func(string, bool, int)) error {
	prefix := p.name + ":"
	if strings.HasPrefix(model, prefix) {
		model = strings.TrimPrefix(model, prefix)
	}

	openAIMessages := make([]openAIChatMessage, len(messages))
	for i, m := range messages {
		openAIMessages[i] = openAIChatMessage{
			Role:    m.Role,
			Content: m.Content,
		}
	}

	reqBody := openAIChatRequest{
		Model:    model,
		Messages: openAIMessages,
		Stream:   true,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("failed to connect to %s: %w", p.name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s API error (%d): %s", p.name, resp.StatusCode, string(body))
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
		if lineStr == "" || lineStr == "data: [DONE]" {
			if lineStr == "data: [DONE]" {
				onChunk("", true, totalTokens)
				break
			}
			continue
		}

		if !strings.HasPrefix(lineStr, "data: ") {
			continue
		}

		jsonData := strings.TrimPrefix(lineStr, "data: ")

		var chunk openAIStreamChunk
		if err := json.Unmarshal([]byte(jsonData), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) > 0 {
			content := chunk.Choices[0].Delta.Content
			done := chunk.Choices[0].FinishReason != nil

			if chunk.Usage != nil {
				totalTokens = chunk.Usage.TotalTokens
			}

			if content != "" || done {
				onChunk(content, done, totalTokens)
			}

			if done {
				break
			}
		}
	}

	return nil
}
