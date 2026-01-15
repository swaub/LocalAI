package services

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/ledongthuc/pdf"
	"github.com/nguyenthenguyen/docx"
)

type DocumentParseResult struct {
	Content  string `json:"content"`
	FileName string `json:"file_name"`
	FileType string `json:"file_type"`
	Pages    int    `json:"pages"`
}

func ParseDocument(filePath string) (*DocumentParseResult, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	fileName := filepath.Base(filePath)

	switch ext {
	case ".pdf":
		content, pages, err := ParsePDF(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to parse PDF: %w", err)
		}
		return &DocumentParseResult{
			Content:  content,
			FileName: fileName,
			FileType: "pdf",
			Pages:    pages,
		}, nil

	case ".docx":
		content, err := ParseDOCX(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to parse DOCX: %w", err)
		}
		return &DocumentParseResult{
			Content:  content,
			FileName: fileName,
			FileType: "docx",
			Pages:    0,
		}, nil

	case ".doc":
		return nil, fmt.Errorf("legacy .doc format is not supported. Please convert to .docx")

	default:
		return nil, fmt.Errorf("unsupported file type: %s", ext)
	}
}

func ParsePDF(filePath string) (string, int, error) {
	f, r, err := pdf.Open(filePath)
	if err != nil {
		return "", 0, fmt.Errorf("failed to open PDF: %w", err)
	}
	defer f.Close()

	totalPages := r.NumPage()
	var buf bytes.Buffer

	for i := 1; i <= totalPages; i++ {
		page := r.Page(i)
		if page.V.IsNull() {
			continue
		}

		text, err := page.GetPlainText(nil)
		if err != nil {
			continue
		}

		if text != "" {
			if buf.Len() > 0 {
				buf.WriteString("\n\n")
			}
			buf.WriteString(fmt.Sprintf("--- Page %d ---\n", i))
			buf.WriteString(text)
		}
	}

	content := strings.TrimSpace(buf.String())
	if content == "" {
		return "", totalPages, fmt.Errorf("no text content found in PDF (may be scanned/image-based)")
	}

	return content, totalPages, nil
}

func ParseDOCX(filePath string) (string, error) {
	r, err := docx.ReadDocxFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to open DOCX: %w", err)
	}
	defer r.Close()

	doc := r.Editable()
	content := doc.GetContent()

	content = strings.TrimSpace(content)

	if content == "" {
		return "", fmt.Errorf("no text content found in DOCX")
	}

	return content, nil
}

func IsSupportedDocument(filePath string) bool {
	ext := strings.ToLower(filepath.Ext(filePath))
	supported := map[string]bool{
		".pdf":  true,
		".docx": true,
	}
	return supported[ext]
}
