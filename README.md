# LocalAI

A desktop app for multi-agent AI conversations. Run up to 4 AI models simultaneously in a single chat, letting them collaborate, debate, and build on each other's responses.

**The first app to enable real-time AI-to-AI collaboration in a consumer-friendly interface.**

## Features

- **Multi-Model Chat** - Up to 4 AI models in one conversation
- **AI Collaboration** - Models respond to each other, not just you
- **Local + Cloud** - Use local models via Ollama or cloud APIs (OpenAI, Anthropic, Google, etc.)
- **Cross-Platform** - Native apps for macOS, Windows, and Linux
- **Privacy First** - Local models run entirely offline

## Download

Get the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [LocalAI_0.0.6_aarch64.dmg](https://github.com/swaub/LocalAI/releases/latest) |
| macOS (Intel) | [LocalAI_0.0.6_x64.dmg](https://github.com/swaub/LocalAI/releases/latest) |
| Windows | [LocalAI_0.0.6_x64-setup.exe](https://github.com/swaub/LocalAI/releases/latest) |
| Linux (Debian/Ubuntu) | [LocalAI_0.0.6_amd64.deb](https://github.com/swaub/LocalAI/releases/latest) |
| Linux (Universal) | [LocalAI_0.0.6_amd64.AppImage](https://github.com/swaub/LocalAI/releases/latest) |

## Quick Start

### 1. Install Ollama (for local models)

LocalAI uses [Ollama](https://ollama.com) to run local AI models. Download it first:

- **macOS/Linux**: https://ollama.com/download
- **Windows**: https://ollama.com/download/windows

### 2. Pull a model

```bash
ollama pull llama3.2:3b
```

Other recommended models:
- `mistral:7b` - Great all-rounder
- `gemma2:2b` - Fast and lightweight
- `qwen2.5:7b` - Strong reasoning

### 3. Launch LocalAI

Open the app. Your installed Ollama models will appear in the sidebar.

### 4. Add models to your chat

Click models from the **Library** to add them to your **Active Team** (up to 4).

### 5. Start chatting

Type a message. All active models will respond and can see each other's responses.

## Using Cloud Providers

Want to use GPT-4, Claude, or Gemini? Go to **Settings** → **Cloud Providers** and add your API key.

Supported providers:
- OpenAI (GPT-4, GPT-4o)
- Anthropic (Claude)
- Google (Gemini)
- DeepSeek
- Groq
- Together AI
- OpenRouter

## Importing Models from LM Studio

Already have models downloaded in LM Studio? You can import them directly:

1. Click the **Upload** icon next to "Library" in the sidebar
2. Browse to your LM Studio models folder and select a `.gguf` file
3. Give it a name and click **Import**

**LM Studio model locations:**

| Platform | Path |
|----------|------|
| macOS / Linux | `~/.cache/lm-studio/models/` |
| Windows | `C:\Users\<username>\.cache\lm-studio\models\` |

## Tips

- **@mention** a specific model to direct your question to it
- Use **Autonomy Mode** to let models have multi-round conversations without your input
- Assign **roles** (Planner, Coder, Reviewer) to models for specialized tasks
- Add **system prompts** to customize each model's behavior
- **Right-click** a local model to show its location in Finder/Explorer

## Requirements

- macOS 10.15+, Windows 10+, or Linux
- [Ollama](https://ollama.com) (for local models)
- 8GB+ RAM recommended for local models

## License

MIT License - see [LICENSE](LICENSE) for details.
