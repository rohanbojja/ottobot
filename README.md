# OttoBot

OttoBot is an interactive coding agent platform where users create persistent coding sessions, interact with an AI agent via WebSocket chat, and watch the agent work in real-time through VNC. The agent executes development tasks securely through the Model Context Protocol (MCP).

## Features

- **Interactive Coding Sessions**: Create isolated development environments with AI assistance
- **Real-time VNC Access**: Watch the AI agent work in a full desktop environment
- **WebSocket Chat**: Communicate with the agent in real-time with smooth auto-scrolling
- **Container Isolation**: Each session runs in its own Docker container
- **MCP Architecture**: Secure tool execution via Model Context Protocol
- **Agent Recovery**: Automatic agent restart when agents are lost or disconnected
- **Multi-Model Support**: Choose from OpenAI GPT, Google Gemini, or Anthropic Claude
- **Horizontal Scalability**: Multiple worker processes for handling concurrent sessions
- **Smart Downloads**: Download workspace with descriptive timestamped filenames

## Architecture

API -> Worker (back pressure) -> Agent (runtime which interfaces with MCP server in the sandbox container).

```
User → API Server (Elysia) → Worker Processes (back pressure agent runtime[for now]) → Sandbox Containers (VNC + MCP Server)
              ↓                     ↓                      ↓
           Redis Queue        Docker + Port Allocation    MCP Tools (File I/O, Commands, VS Code)
                                     ↓
                              LangGraph Agent ← HTTP → MCP Server (Development Tools)
```

### MCP (Model Context Protocol) Architecture

- **Secure Tool Execution**: Agent brain runs in worker, tools execute in isolated container
- **HTTP Communication**: Agent connects to container's MCP server via allocated ports
- **Tool Isolation**: File operations, command execution, and VS Code access happen in container
- **Dynamic Port Allocation**: Each session gets dedicated VNC (6080-6200) and MCP (8080-8200) ports

## Tech Stack

- **Runtime**: Bun + TypeScript
- **API Framework**: Elysia with WebSocket support
- **Queue**: BullMQ + Redis
- **AI Agent**: LangGraph + Multi-Model Support (OpenAI GPT, Google Gemini, Anthropic Claude)
- **Containers**: Docker with VNC access + MCP server
- **MCP**: Model Context Protocol for secure agent-container communication
- **Development Environment**: Ubuntu + VSCode + full dev tools

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Bun runtime
- Redis (or use Docker Compose)
- LLM API key (OpenAI, Google Gemini, or Anthropic)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ottobot
```

2. Install dependencies:
```bash
bun install
```

3. Copy environment configuration:
```bash
cp .env.example .env
```

4. Configure your `.env` file with your preferred LLM:
```env
# Choose one or more:
OPENAI_API_KEY=your_openai_key_here
GEMINI_API_KEY=your_gemini_key_here  
ANTHROPIC_API_KEY=your_anthropic_key_here

# Set default model
LLM_MODEL=gpt-4.1-nano  # or gemini-1.5-flash, claude-3-5-sonnet-20241022
```

### Running with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Local Development Setup

**Prerequisites:**
- Docker must be installed and running
- Bun runtime installed
- LLM API key (OpenAI, Google Gemini, or Anthropic)

**Step-by-step setup:**

1. **Build the development agent image:**
```bash
docker build -f docker/Dockerfile.agent -t ottobot-agent .
```

2. **Start Redis using Docker Compose:**
```bash
docker-compose -f docker-compose.dev.yml up -d
```

3. **Start the services locally:**

Terminal 1 - API Server (Port 3000):
```bash
bun run dev:api
```

Terminal 2 - Worker Process:
```bash
bun run dev:worker
```

Terminal 3 - Frontend (Port 5173):
```bash
cd frontend
bun run dev
```

**Access the application:**
- Frontend: http://localhost:5173
- API: http://localhost:3000
- Queue Monitor: http://localhost:3000/ui (Bull Board)
- API Documentation: http://localhost:3000/swagger

**Important Notes:**
- Docker daemon must be running for session creation to work
- Sessions create isolated containers using the `ottobot-dev-agent` image
- Each session gets allocated VNC ports (6080-6200) and MCP ports (8080-8200)
- Frontend generates API client from OpenAPI schema with `bun generate:api`

## API Usage

### Create a Session

```bash
curl -X POST http://localhost:3000/session \
  -H "Content-Type: application/json" \
  -d '{
    "initial_prompt": "Build a React todo app with TypeScript",
    "environment": "node"
  }'
```

Response:
```json
{
  "session_id": "abc123",
  "status": "initializing",
  "vnc_url": "http://localhost:6080/vnc.html",
  "chat_url": "ws://localhost:3000/session/abc123/chat",
  "created_at": "2024-01-01T00:00:00Z",
  "expires_at": "2024-01-01T01:00:00Z"
}
```

### Connect to WebSocket Chat

```javascript
const ws = new WebSocket('ws://localhost:3000/session/abc123/chat');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Agent:', message);
};

ws.send(JSON.stringify({
  type: 'user_prompt',
  content: 'Add dark mode support',
  timestamp: Date.now()
}));
```

### Access VNC

Open the VNC URL in your browser to watch the agent work in real-time.

### Download Session Workspace

```bash
curl -O http://localhost:3000/download/abc123
# Downloads: ottobot-session-abc123-20240101T120000.zip
```

## API Endpoints

- `POST /session` - Create a new coding session
- `GET /session/:id` - Get session status
- `DELETE /session/:id` - Terminate session
- `GET /session/:id/logs` - Get session logs
- `WS /session/:id/chat` - WebSocket chat endpoint
- `GET /download/:id` - Download session workspace as zip
- `GET /health` - System health check
- `GET /metrics` - System metrics

## Configuration

See `.env.example` for all configuration options:

- **API Configuration**: Port, host settings
- **Redis Configuration**: Connection details
- **Worker Configuration**: Concurrency, session limits
- **Container Configuration**: Resource limits, VNC ports
- **Agent Configuration**: LLM settings, context window

## Architecture Details

### Session Lifecycle

1. User creates session via POST /session
2. Session assigned to worker using consistent hashing
3. Worker allocates VNC and MCP ports
4. Worker creates Docker container with VNC + MCP server
5. Agent connects to container's MCP server for tool execution
6. Agent starts and processes initial prompt
7. User connects via WebSocket and VNC
8. Agent executes tasks via MCP, visible through VNC
9. User downloads artifacts when complete
10. Session auto-terminates after timeout, ports released

### Components

- **API Server**: Handles HTTP/WebSocket requests, session management
- **Workers**: Manage Docker containers, port allocation, and agent processes
- **Redis**: Session state, job queue, message routing, port allocation
- **Agent**: LangGraph-based AI that connects to containers via MCP
- **MCP Server**: Provides secure development tools within containers
- **Containers**: Isolated Ubuntu environments with VNC + MCP server + full dev tools

## Development

### Project Structure

```
src/
├── api/           # Elysia API server
├── worker/        # BullMQ worker processes
├── agent/         # LangGraph coding agent
├── mcp/           # Model Context Protocol (server & client)
├── shared/        # Shared types and utilities
└── index.ts       # Entry point
```

### Building

```bash
# Build for production
bun build src/index.ts --outdir=dist --target=bun

# Build Docker images
docker-compose build
```

### Testing

```bash
# Run type checking
bun run typecheck

# Run linting
bun run lint
```

## Deployment

### Production Considerations

1. **Security**: 
   - Use HTTPS/WSS in production
   - Implement proper authentication
   - Restrict container capabilities
   - Network isolation between sessions

2. **Scaling**:
   - Deploy multiple worker instances
   - Use Redis Cluster for high availability
   - Load balance API servers
   - Monitor resource usage

3. **Monitoring**:
   - Health checks at `/health`
   - Metrics at `/metrics`
   - Container resource monitoring
   - Session analytics

## Recent Improvements

- ✅ **Agent Recovery System**: Automatic agent restart when agents are lost or disconnected
- ✅ **Fixed Streaming Chat**: Resolved LangGraph streaming response processing
- ✅ **Smooth Chat Interface**: Auto-scrolling chat with Tailwind CSS animations
- ✅ **Enhanced Downloads**: Workspace downloads with descriptive timestamped filenames
- ✅ **Multi-Model Support**: OpenAI GPT, Google Gemini, and Anthropic Claude integration
- ✅ **Improved Error Handling**: Better session management and resource cleanup
- ✅ **Frontend Enhancements**: Better button alignment and user experience

## Planned Enhancements

1. **Better Agent Workflow**: Implement plan → refine → execute cycle for more structured development
2. **Model Selector**: UI component for choosing LLM model per session
3. **Context Compression**: Smart context management for long conversations
4. **VSCode MCP Integration**: Direct VS Code integration via Model Context Protocol
5. **Puppeteer MCP**: Browser automation capabilities for web development tasks

## License

MIT