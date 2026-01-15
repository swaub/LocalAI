package handlers

import (
	"github.com/gofiber/fiber/v2"
	"localai/database"
	"localai/services"
)

type ProviderInfo struct {
	Name       string   `json:"name"`
	Configured bool     `json:"configured"`
	Enabled    bool     `json:"enabled"`
	Models     []string `json:"models"`
}

func ListProviders(c *fiber.Ctx) error {
	providers := []ProviderInfo{
		{Name: "ollama", Configured: true, Enabled: true, Models: []string{}},
	}

	ollamaModels, err := services.ListModels()
	if err == nil {
		for _, m := range ollamaModels {
			providers[0].Models = append(providers[0].Models, m.Name)
		}
	}

	for name, config := range services.OpenAIProviderConfigs {
		info := ProviderInfo{
			Name:       name,
			Configured: false,
			Enabled:    false,
			Models:     config.Models,
		}

		if pk, err := database.GetProviderKey(name); err == nil {
			info.Configured = true
			info.Enabled = pk.Enabled
		}

		providers = append(providers, info)
	}

	anthropicInfo := ProviderInfo{
		Name:       "anthropic",
		Configured: false,
		Enabled:    false,
		Models:     services.AnthropicModels,
	}
	if pk, err := database.GetProviderKey("anthropic"); err == nil {
		anthropicInfo.Configured = true
		anthropicInfo.Enabled = pk.Enabled
	}
	providers = append(providers, anthropicInfo)

	geminiInfo := ProviderInfo{
		Name:       "gemini",
		Configured: false,
		Enabled:    false,
		Models:     services.GeminiModels,
	}
	if pk, err := database.GetProviderKey("gemini"); err == nil {
		geminiInfo.Configured = true
		geminiInfo.Enabled = pk.Enabled
	}
	providers = append(providers, geminiInfo)

	return c.JSON(providers)
}

func SetProviderKey(c *fiber.Ctx) error {
	providerName := c.Params("name")

	var req struct {
		APIKey string `json:"api_key"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	validProvider := false
	if _, ok := services.OpenAIProviderConfigs[providerName]; ok {
		validProvider = true
	}
	if providerName == "anthropic" || providerName == "gemini" {
		validProvider = true
	}
	if !validProvider {
		return c.Status(400).JSON(fiber.Map{"error": "Unknown provider"})
	}

	if req.APIKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "API key required"})
	}

	if err := validateProviderKey(providerName, req.APIKey); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": err.Error()})
	}

	if err := database.SaveProviderKey(providerName, req.APIKey); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save API key"})
	}

	registerProvider(providerName, req.APIKey)

	return c.JSON(fiber.Map{"status": "success", "message": "API key saved"})
}

func validateProviderKey(name, apiKey string) error {
	switch name {
	case "anthropic":
		return services.ValidateAnthropicKey(apiKey)
	case "gemini":
		return services.ValidateGeminiKey(apiKey)
	default:
		// OpenAI-compatible providers
		if _, ok := services.OpenAIProviderConfigs[name]; ok {
			return services.ValidateOpenAIKey(name, apiKey)
		}
		return nil
	}
}

func registerProvider(name, apiKey string) {
	switch name {
	case "anthropic":
		services.RegisterAnthropicProvider(apiKey)
	case "gemini":
		services.RegisterGeminiProvider(apiKey)
	default:
		services.RegisterOpenAIProvider(name, apiKey)
	}
}

func DeleteProviderKey(c *fiber.Ctx) error {
	providerName := c.Params("name")

	if err := database.DeleteProviderKey(providerName); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete API key"})
	}

	services.Providers.Unregister(providerName)

	return c.JSON(fiber.Map{"status": "success", "message": "API key deleted"})
}

func ToggleProvider(c *fiber.Ctx) error {
	providerName := c.Params("name")

	var req struct {
		Enabled bool `json:"enabled"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if err := database.SetProviderEnabled(providerName, req.Enabled); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update provider"})
	}

	if req.Enabled {
		if pk, err := database.GetProviderKey(providerName); err == nil {
			registerProvider(providerName, pk.APIKey)
		}
	} else {
		services.Providers.Unregister(providerName)
	}

	return c.JSON(fiber.Map{"status": "success", "enabled": req.Enabled})
}

func GetProviderModels(c *fiber.Ctx) error {
	providerName := c.Params("name")

	provider := services.Providers.Get(providerName)
	if provider == nil {
		return c.Status(404).JSON(fiber.Map{"error": "Provider not found or not configured"})
	}

	models, err := provider.ListModels()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(models)
}
