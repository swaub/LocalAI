package main

import (
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/websocket/v2"

	"localai/database"
	"localai/handlers"
	"localai/services"
)

func main() {
	if err := database.Init(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	services.InitOllama("http://localhost:11434")
	initCloudProviders()

	app := fiber.New(fiber.Config{
		AppName: "LocalAI",
	})

	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Get("/api/health", handlers.HealthCheck)

	app.Get("/api/models", handlers.ListModels)
	app.Get("/api/ollama/status", handlers.CheckOllamaStatus)
	app.Post("/api/models/pull", handlers.PullModel)
	app.Get("/api/models/pull/stream", handlers.PullModelStream)
	app.Delete("/api/models/:name", handlers.DeleteModel)
	app.Post("/api/models/import", handlers.ImportGGUF)
	app.Get("/api/models/gguf", handlers.ListGGUFFiles)

	app.Post("/api/documents/parse", handlers.ParseDocument)

	app.Get("/api/sessions", handlers.ListSessions)
	app.Post("/api/sessions", handlers.CreateSession)
	app.Get("/api/sessions/:id", handlers.GetSession)
	app.Put("/api/sessions/:id", handlers.UpdateSession)
	app.Delete("/api/sessions/:id", handlers.DeleteSession)

	app.Get("/api/providers", handlers.ListProviders)
	app.Put("/api/providers/:name/key", handlers.SetProviderKey)
	app.Delete("/api/providers/:name/key", handlers.DeleteProviderKey)
	app.Put("/api/providers/:name/toggle", handlers.ToggleProvider)
	app.Get("/api/providers/:name/models", handlers.GetProviderModels)

	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws/:sessionId", websocket.New(handlers.WebSocketHandler))

	log.Println("Starting LocalAI server on :8000")
	if err := app.Listen(":8000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func initCloudProviders() {
	keys, err := database.GetAllProviderKeys()
	if err != nil {
		return
	}

	for _, k := range keys {
		if k.Enabled {
			switch k.Provider {
			case "anthropic":
				services.RegisterAnthropicProvider(k.APIKey)
			case "gemini":
				services.RegisterGeminiProvider(k.APIKey)
			default:
				services.RegisterOpenAIProvider(k.Provider, k.APIKey)
			}
		}
	}
}
