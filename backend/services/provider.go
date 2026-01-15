package services

import (
	"context"
	"fmt"
)

type Provider interface {
	Name() string
	StreamChat(ctx context.Context, model string, messages []ChatMessage, onChunk func(string, bool, int)) error
	ListModels() ([]Model, error)
	SupportsModel(modelID string) bool
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Model struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	Size       int64  `json:"size,omitempty"`
	ModifiedAt string `json:"modified_at,omitempty"`
}

type ProviderConfig struct {
	Type    string `json:"type"`
	APIKey  string `json:"api_key,omitempty"`
	BaseURL string `json:"base_url,omitempty"`
}

type ProviderRegistry struct {
	providers map[string]Provider
}

func NewProviderRegistry() *ProviderRegistry {
	return &ProviderRegistry{
		providers: make(map[string]Provider),
	}
}

func (r *ProviderRegistry) Register(p Provider) {
	r.providers[p.Name()] = p
}

func (r *ProviderRegistry) Unregister(name string) {
	delete(r.providers, name)
}

func (r *ProviderRegistry) Get(name string) Provider {
	return r.providers[name]
}

func (r *ProviderRegistry) GetForModel(modelID string) Provider {
	for _, p := range r.providers {
		if p.SupportsModel(modelID) {
			return p
		}
	}
	return nil
}

func (r *ProviderRegistry) ListAll() []Provider {
	result := make([]Provider, 0, len(r.providers))
	for _, p := range r.providers {
		result = append(result, p)
	}
	return result
}

var Providers = NewProviderRegistry()

func StreamChatToProvider(ctx context.Context, modelID string, messages []ChatMessage, onChunk func(string, bool, int)) error {
	provider := Providers.GetForModel(modelID)
	if provider == nil {
		return fmt.Errorf("no provider found for model: %s", modelID)
	}
	return provider.StreamChat(ctx, modelID, messages, onChunk)
}

func ListAllModels() ([]Model, error) {
	var allModels []Model
	for _, p := range Providers.ListAll() {
		models, err := p.ListModels()
		if err != nil {
			continue
		}
		allModels = append(allModels, models...)
	}
	return allModels, nil
}
