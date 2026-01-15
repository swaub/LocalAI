package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"localai/services"
)

func ListModels(c *fiber.Ctx) error {
	models, err := services.ListAllModels()
	if err != nil {
		return c.Status(503).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.JSON(models)
}

func CheckOllamaStatus(c *fiber.Ctx) error {
	available := services.CheckOllamaHealth()
	return c.JSON(fiber.Map{
		"available": available,
	})
}

func PullModel(c *fiber.Ctx) error {
	var req struct {
		Name string `json:"name"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Model name required"})
	}

	err := services.PullModel(context.Background(), req.Name, nil)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"status": "success", "message": "Model pulled successfully"})
}

func PullModelStream(c *fiber.Ctx) error {
	modelName := c.Query("name")

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	if modelName == "" {
		c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
			errorData, _ := json.Marshal(map[string]interface{}{
				"status": "error",
				"error":  "Model name required",
				"done":   true,
			})
			fmt.Fprintf(w, "data: %s\n\n", errorData)
			w.Flush()
		})
		return nil
	}

	ctx := c.Context()
	ctx.SetBodyStreamWriter(func(w *bufio.Writer) {
		onProgress := func(status string, completed, total int64) {
			data := map[string]interface{}{
				"status":    status,
				"completed": completed,
				"total":     total,
			}
			jsonData, _ := json.Marshal(data)
			fmt.Fprintf(w, "data: %s\n\n", jsonData)
			w.Flush()
		}

		err := services.PullModel(context.Background(), modelName, onProgress)

		var finalData []byte
		if err != nil {
			finalData, _ = json.Marshal(map[string]interface{}{
				"status": "error",
				"error":  err.Error(),
				"done":   true,
			})
		} else {
			finalData, _ = json.Marshal(map[string]interface{}{
				"status": "success",
				"done":   true,
			})
		}
		fmt.Fprintf(w, "data: %s\n\n", finalData)
		w.Flush()
	})

	return nil
}

func PullModelStreamPost(c *fiber.Ctx) error {
	var req struct {
		Name string `json:"name"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Model name required"})
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		onProgress := func(status string, completed, total int64) {
			data := map[string]interface{}{
				"status":    status,
				"completed": completed,
				"total":     total,
			}
			jsonData, _ := json.Marshal(data)
			fmt.Fprintf(w, "data: %s\n\n", jsonData)
			w.Flush()
		}

		err := services.PullModel(context.Background(), req.Name, onProgress)

		var finalData []byte
		if err != nil {
			finalData, _ = json.Marshal(map[string]interface{}{
				"status": "error",
				"error":  err.Error(),
				"done":   true,
			})
		} else {
			finalData, _ = json.Marshal(map[string]interface{}{
				"status": "success",
				"done":   true,
			})
		}
		fmt.Fprintf(w, "data: %s\n\n", finalData)
		w.Flush()
	})

	return nil
}

func DeleteModel(c *fiber.Ctx) error {
	modelName := c.Params("name")
	if modelName == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Model name required"})
	}

	modelName = strings.ReplaceAll(modelName, "%3A", ":")

	err := services.DeleteModel(modelName)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"status": "success", "message": "Model deleted"})
}

func ImportGGUF(c *fiber.Ctx) error {
	var req struct {
		Name     string `json:"name"`
		FilePath string `json:"file_path"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Name == "" || req.FilePath == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name and file_path required"})
	}

	if _, err := os.Stat(req.FilePath); os.IsNotExist(err) {
		return c.Status(400).JSON(fiber.Map{"error": "GGUF file not found"})
	}

	if !strings.HasSuffix(strings.ToLower(req.FilePath), ".gguf") {
		return c.Status(400).JSON(fiber.Map{"error": "File must be a .gguf file"})
	}

	err := services.CreateModelFromGGUF(req.Name, req.FilePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"status": "success", "message": "Model imported successfully"})
}

func ListGGUFFiles(c *fiber.Ctx) error {
	modelsDir := "./models"

	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create models directory"})
	}

	var files []fiber.Map
	err := filepath.Walk(modelsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".gguf") {
			absPath, _ := filepath.Abs(path)
			files = append(files, fiber.Map{
				"name":      info.Name(),
				"path":      absPath,
				"size":      info.Size(),
				"modified":  info.ModTime(),
			})
		}
		return nil
	})

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to list files"})
	}

	return c.JSON(fiber.Map{
		"directory": modelsDir,
		"files":     files,
	})
}
