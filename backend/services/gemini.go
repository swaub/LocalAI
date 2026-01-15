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

type GeminiProvider struct {
	apiKey string
}

var GeminiModels = []string{
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-2.0-flash",
	"gemini-2.0-flash-lite",
}

func NewGeminiProvider(apiKey string) *GeminiProvider {
	return &GeminiProvider{apiKey: apiKey}
}

func RegisterGeminiProvider(apiKey string) {
	provider := NewGeminiProvider(apiKey)
	Providers.Register(provider)
}

func ValidateGeminiKey(apiKey string) error {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", apiKey)

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to connect to Gemini: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 400 || resp.StatusCode == 401 || resp.StatusCode == 403 {
		return fmt.Errorf("invalid API key")
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(body))
	}

	return nil
}

func (p *GeminiProvider) Name() string {
	return "gemini"
}

func (p *GeminiProvider) SupportsModel(modelID string) bool {
	if strings.HasPrefix(modelID, "gemini:") {
		return true
	}
	for _, m := range GeminiModels {
		if m == modelID {
			return true
		}
	}
	return false
}

func (p *GeminiProvider) ListModels() ([]Model, error) {
	models := make([]Model, len(GeminiModels))
	for i, m := range GeminiModels {
		models[i] = Model{
			ID:       "gemini:" + m,
			Name:     m,
			Provider: "gemini",
		}
	}
	return models, nil
}

type geminiRequest struct {
	Contents         []geminiContent        `json:"contents"`
	SystemInstruction *geminiContent        `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiGenerationConfig struct {
	MaxOutputTokens int `json:"maxOutputTokens,omitempty"`
}

type geminiStreamResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
		FinishReason string `json:"finishReason,omitempty"`
	} `json:"candidates"`
	UsageMetadata *struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata,omitempty"`
}

func (p *GeminiProvider) StreamChat(ctx context.Context, model string, messages []ChatMessage, onChunk func(string, bool, int)) error {
	if strings.HasPrefix(model, "gemini:") {
		model = strings.TrimPrefix(model, "gemini:")
	}

	var contents []geminiContent
	var systemInstruction *geminiContent

	for _, m := range messages {
		if m.Role == "system" {
			systemInstruction = &geminiContent{
				Parts: []geminiPart{{Text: m.Content}},
			}
		} else {
			role := m.Role
			if role == "assistant" {
				role = "model"
			}
			contents = append(contents, geminiContent{
				Role:  role,
				Parts: []geminiPart{{Text: m.Content}},
			})
		}
	}

	reqBody := geminiRequest{
		Contents:         contents,
		SystemInstruction: systemInstruction,
		GenerationConfig: &geminiGenerationConfig{
			MaxOutputTokens: 4096,
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent?alt=sse&key=%s", model, p.apiKey)

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("failed to connect to Gemini: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Gemini API error (%d): %s", resp.StatusCode, string(body))
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
				onChunk("", true, totalTokens)
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

		var response geminiStreamResponse
		if err := json.Unmarshal([]byte(jsonData), &response); err != nil {
			continue
		}

		if response.UsageMetadata != nil {
			totalTokens = response.UsageMetadata.TotalTokenCount
		}

		if len(response.Candidates) > 0 {
			candidate := response.Candidates[0]
			if len(candidate.Content.Parts) > 0 {
				text := candidate.Content.Parts[0].Text
				if text != "" {
					onChunk(text, false, totalTokens)
				}
			}
			if candidate.FinishReason == "STOP" {
				onChunk("", true, totalTokens)
				return nil
			}
		}
	}

	return nil
}
