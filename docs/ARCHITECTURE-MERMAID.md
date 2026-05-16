# OttoBot Architecture - Mermaid Diagrams

## Current Architecture

```mermaid
graph TB
    User[User]
    Frontend[Tauri + React Desktop]
    API[Elysia API<br/>HTTP + AI SDK UI streams]
    Registry[SQLite Registry<br/>sessions, logs, UI messages, ports]
    Orchestrator[SessionOrchestrator]
    Agent[AI SDK ToolLoopAgent]
    Sandbox[Docker Sandbox<br/>VNC + noVNC + MCP Server]

    User --> Frontend
    Frontend <--> API
    API <--> Registry
    API --> Orchestrator
    Orchestrator <--> Registry
    Orchestrator <--> Sandbox
    Orchestrator <--> Agent
    Agent <-. HTTP MCP .-> Sandbox
    Frontend -. VNC .-> Sandbox
```

## Session Creation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Desktop
    participant A as API
    participant D as SQLite
    participant O as Orchestrator
    participant C as Docker Sandbox
    participant G as Agent

    U->>F: Create session
    F->>A: POST /session
    A->>D: Insert initializing session
    A->>D: Allocate VNC and MCP ports
    A->>O: createSession
    O->>C: Create/start sandbox
    O->>C: Wait for VNC/MCP readiness
    O->>G: Initialize local agent runtime
    O->>D: Mark session ready
    A-->>F: Session response
    F-->>U: Chat + VNC ready
```

## Chat Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Desktop
    participant A as API HTTP Stream
    participant D as SQLite
    participant G as Agent
    participant C as MCP Server in Sandbox

    U->>F: Send message
    F->>A: POST /session/:id/chat
    A->>D: Store incoming UIMessage[]
    A->>G: streamMessages locally
    G->>C: MCP tool call
    C-->>G: Tool result
    G->>D: Store final UIMessage[]
    G-->>A: AI SDK stream chunks
    A-->>F: UI message stream response
    F-->>U: Display update
```

## Sandbox Tool Surface

```mermaid
graph LR
    Agent[AI SDK Agent]
    MCP[Sandbox MCP Server]
    Files[Workspace<br/>read/search/edit]
    Shell[Shell<br/>commands + managed processes]
    Browser[Playwright Browser<br/>state/actions/logs/network]
    Computer[X11 Desktop<br/>mouse/keyboard/screenshots/windows]

    Agent <-. HTTP MCP .-> MCP
    MCP --> Files
    MCP --> Shell
    MCP --> Browser
    MCP --> Computer
```
