package handlers

import (
	"github.com/gofiber/fiber/v2"
	"localai/services"
)

func HealthCheck(c *fiber.Ctx) error {
	ollamaStatus := "unavailable"
	if services.CheckOllamaHealth() {
		ollamaStatus = "healthy"
	}

	return c.JSON(fiber.Map{
		"api":    "healthy",
		"ollama": ollamaStatus,
	})
}
