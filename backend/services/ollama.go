package services

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var ollamaURL string

func InitOllama(url string) {
	ollamaURL = url
	Providers.Register(NewOllamaProvider(url))
}

type OllamaProvider struct {
	baseURL string
}

func NewOllamaProvider(baseURL string) *OllamaProvider {
	return &OllamaProvider{baseURL: baseURL}
}

func (p *OllamaProvider) Name() string {
	return "ollama"
}

func (p *OllamaProvider) SupportsModel(modelID string) bool {
	if strings.HasPrefix(modelID, "ollama:") {
		return true
	}
	cloudPrefixes := []string{"anthropic:", "gemini:", "openai:", "deepseek:", "groq:", "together:", "openrouter:"}
	for _, prefix := range cloudPrefixes {
		if strings.HasPrefix(modelID, prefix) {
			return false
		}
	}
	return true
}

func (p *OllamaProvider) ListModels() ([]Model, error) {
	ollamaModels, err := ListModels()
	if err != nil {
		return nil, err
	}

	models := make([]Model, len(ollamaModels))
	for i, m := range ollamaModels {
		models[i] = Model{
			ID:         m.Name,
			Name:       m.Name,
			Provider:   "ollama",
			Size:       m.Size,
			ModifiedAt: m.ModifiedAt,
		}
	}
	return models, nil
}

func (p *OllamaProvider) StreamChat(ctx context.Context, model string, messages []ChatMessage, onChunk func(string, bool, int)) error {
	ollamaMessages := make([]OllamaChatMessage, len(messages))
	for i, m := range messages {
		ollamaMessages[i] = OllamaChatMessage{
			Role:    m.Role,
			Content: m.Content,
		}
	}
	return StreamChat(ctx, model, ollamaMessages, onChunk)
}

type OllamaModel struct {
	Name       string `json:"name"`
	ModifiedAt string `json:"modified_at"`
	Size       int64  `json:"size"`
	Digest     string `json:"digest"`
}

type OllamaListResponse struct {
	Models []OllamaModel `json:"models"`
}

type OllamaChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OllamaChatOptions struct {
	NumPredict int `json:"num_predict,omitempty"`
	NumCtx     int `json:"num_ctx,omitempty"`
}

type OllamaChatRequest struct {
	Model    string              `json:"model"`
	Messages []OllamaChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
	Options  *OllamaChatOptions  `json:"options,omitempty"`
}

type OllamaChatResponse struct {
	Model     string            `json:"model"`
	Message   OllamaChatMessage `json:"message"`
	Done      bool              `json:"done"`
	EvalCount int               `json:"eval_count,omitempty"`
}

func CheckOllamaHealth() bool {
	resp, err := http.Get(ollamaURL + "/api/tags")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func ListModels() ([]OllamaModel, error) {
	resp, err := http.Get(ollamaURL + "/api/tags")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Ollama: %w", err)
	}
	defer resp.Body.Close()

	var result OllamaListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Models, nil
}

func PullModel(ctx context.Context, modelName string, onProgress func(status string, completed, total int64)) error {
	reqBody := map[string]interface{}{
		"name":   modelName,
		"stream": true,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", ollamaURL+"/api/pull", bytes.NewBuffer(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to Ollama: %w", err)
	}
	defer resp.Body.Close()

	reader := bufio.NewReader(resp.Body)

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
			return err
		}

		var progress struct {
			Status    string `json:"status"`
			Completed int64  `json:"completed"`
			Total     int64  `json:"total"`
			Error     string `json:"error"`
		}
		if err := json.Unmarshal(line, &progress); err != nil {
			continue
		}

		if progress.Error != "" {
			return fmt.Errorf("pull error: %s", progress.Error)
		}

		if onProgress != nil {
			onProgress(progress.Status, progress.Completed, progress.Total)
		}

		if progress.Status == "success" {
			break
		}
	}

	return nil
}

func DeleteModel(modelName string) error {
	reqBody := map[string]string{"name": modelName}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("DELETE", ollamaURL+"/api/delete", bytes.NewBuffer(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to Ollama: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete model: %s", string(body))
	}

	return nil
}

func CreateModelFromGGUF(modelName, ggufPath string) error {
	// Step 1: Open the file and calculate SHA256
	file, err := os.Open(ggufPath)
	if err != nil {
		return fmt.Errorf("failed to open GGUF file: %w", err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return fmt.Errorf("failed to calculate file hash: %w", err)
	}
	digest := "sha256:" + hex.EncodeToString(hasher.Sum(nil))

	// Step 2: Upload the blob to Ollama
	file.Seek(0, 0) // Reset file pointer to beginning

	blobURL := fmt.Sprintf("%s/api/blobs/%s", ollamaURL, digest)
	req, err := http.NewRequest("POST", blobURL, file)
	if err != nil {
		return fmt.Errorf("failed to create blob request: %w", err)
	}

	fileInfo, _ := file.Stat()
	req.ContentLength = fileInfo.Size()
	req.Header.Set("Content-Type", "application/octet-stream")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to upload blob to Ollama: %w", err)
	}
	defer resp.Body.Close()

	// 201 Created or 200 OK means success, 400 means blob already exists (also ok)
	if resp.StatusCode != 201 && resp.StatusCode != 200 && resp.StatusCode != 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to upload blob: %s", string(body))
	}

	// Step 3: Create the model using the files parameter
	fileName := filepath.Base(ggufPath)
	createReq := map[string]interface{}{
		"model": modelName,
		"files": map[string]string{
			fileName: digest,
		},
	}

	jsonBody, err := json.Marshal(createReq)
	if err != nil {
		return err
	}

	createResp, err := http.Post(ollamaURL+"/api/create", "application/json", bytes.NewBuffer(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create model: %w", err)
	}
	defer createResp.Body.Close()

	// Read and check the streaming response for errors
	scanner := bufio.NewScanner(createResp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		var status map[string]interface{}
		if err := json.Unmarshal([]byte(line), &status); err == nil {
			if errMsg, ok := status["error"].(string); ok {
				return fmt.Errorf("failed to create model: %s", errMsg)
			}
		}
	}

	if createResp.StatusCode != 200 {
		return fmt.Errorf("failed to create model: status %d", createResp.StatusCode)
	}

	return nil
}

func StreamChat(ctx context.Context, model string, messages []OllamaChatMessage, onChunk func(string, bool, int)) error {
	reqBody := OllamaChatRequest{
		Model:    model,
		Messages: messages,
		Stream:   true,
		Options: &OllamaChatOptions{
			NumPredict: 4096,
			NumCtx:     8192,
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", ollamaURL+"/api/chat", bytes.NewBuffer(jsonBody))
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
		return fmt.Errorf("failed to connect to Ollama: %w", err)
	}
	defer resp.Body.Close()

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

		var chunk OllamaChatResponse
		if err := json.Unmarshal(line, &chunk); err != nil {
			continue
		}

		if chunk.EvalCount > 0 {
			totalTokens = chunk.EvalCount
		}

		onChunk(chunk.Message.Content, chunk.Done, totalTokens)

		if chunk.Done {
			break
		}
	}

	return nil
}
