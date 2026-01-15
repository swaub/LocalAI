package handlers

import (
	"localai/services"

	"github.com/gofiber/fiber/v2"
)

type ParseDocumentRequest struct {
	FilePath string `json:"file_path"`
}

type ParseDocumentResponse struct {
	Success  bool   `json:"success"`
	Content  string `json:"content"`
	FileName string `json:"file_name"`
	FileType string `json:"file_type"`
	Pages    int    `json:"pages"`
}

type ParseDocumentErrorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

func ParseDocument(c *fiber.Ctx) error {
	var req ParseDocumentRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ParseDocumentErrorResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	if req.FilePath == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ParseDocumentErrorResponse{
			Success: false,
			Error:   "file_path is required",
		})
	}

	if !services.IsSupportedDocument(req.FilePath) {
		return c.Status(fiber.StatusBadRequest).JSON(ParseDocumentErrorResponse{
			Success: false,
			Error:   "Unsupported file type. Supported types: .pdf, .docx",
		})
	}

	result, err := services.ParseDocument(req.FilePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ParseDocumentErrorResponse{
			Success: false,
			Error:   err.Error(),
		})
	}

	return c.JSON(ParseDocumentResponse{
		Success:  true,
		Content:  result.Content,
		FileName: result.FileName,
		FileType: result.FileType,
		Pages:    result.Pages,
	})
}
