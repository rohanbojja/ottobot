<script lang="ts">
  import { Plus, Activity, Zap, Monitor } from "@lucide/svelte";
  import * as Button from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { getSessionStatusColor } from "$lib/utils.js";
  import { createHealthQuery, createMetricsQuery, createSessionMutation } from "$lib/api/queries.js";

  // Use real API queries
  const healthQuery = createHealthQuery();
  const metricsQuery = createMetricsQuery();
  const sessionMutation = createSessionMutation();

  let isCreating = $state(false);

  async function createSession() {
    isCreating = true;
    try {
      await $sessionMutation.mutateAsync({
        initial_prompt: "Create a new coding session",
        environment: "node",
      });
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      isCreating = false;
    }
  }

  function openSession(sessionId: string) {
    window.location.href = `/session/${sessionId}`;
  }

  // Mock data for sessions since we don't have a list endpoint yet
  let mockSessions = $state([
    {
      id: "session-1",
      status: "running",
      initial_prompt: "Build a React todo app with TypeScript",
      created_at: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
      environment: "node",
    },
    {
      id: "session-2",
      status: "ready",
      initial_prompt: "Create a Python FastAPI backend",
      created_at: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
      environment: "python",
    },
  ]);
</script>

<svelte:head>
  <title>OttoBot Dashboard</title>
</svelte:head>

<div class="container mx-auto p-6">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p class="text-muted-foreground">
        Manage your coding sessions and watch AI agents work in real-time
      </p>
    </div>
    <Button.Button onclick={createSession} disabled={isCreating}>
      <Plus class="mr-2 h-4 w-4" />
      {isCreating ? "Creating..." : "New Session"}
    </Button.Button>
  </div>

  <!-- Stats Cards -->
  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
    <Card.Card>
      <Card.CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <Card.CardTitle class="text-sm font-medium">Active Sessions</Card.CardTitle>
        <Activity class="h-4 w-4 text-muted-foreground" />
      </Card.CardHeader>
      <Card.CardContent>
        <div class="text-2xl font-bold">
          {#if $metricsQuery.data}
            {$metricsQuery.data.active_sessions}
          {:else}
            2
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">Currently running</p>
      </Card.CardContent>
    </Card.Card>

    <Card.Card>
      <Card.CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <Card.CardTitle class="text-sm font-medium">Total Sessions</Card.CardTitle>
        <Zap class="h-4 w-4 text-muted-foreground" />
      </Card.CardHeader>
      <Card.CardContent>
        <div class="text-2xl font-bold">
          {#if $metricsQuery.data}
            {$metricsQuery.data.total_sessions}
          {:else}
            12
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">All time</p>
      </Card.CardContent>
    </Card.Card>

    <Card.Card>
      <Card.CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <Card.CardTitle class="text-sm font-medium">System Status</Card.CardTitle>
        <Monitor class="h-4 w-4 text-muted-foreground" />
      </Card.CardHeader>
      <Card.CardContent>
        {#if $healthQuery.isLoading}
          <span class="text-sm text-muted-foreground">Loading...</span>
        {:else if $healthQuery.error}
          <div class="flex items-center">
            <div class="h-2 w-2 bg-red-500 rounded-full mr-2"></div>
            <span class="text-sm text-muted-foreground">Offline</span>
          </div>
        {:else if $healthQuery.data}
          <div class="flex items-center">
            <div class="h-2 w-2 bg-green-500 rounded-full mr-2"></div>
            <span class="text-sm text-muted-foreground">{$healthQuery.data.status}</span>
          </div>
        {/if}
      </Card.CardContent>
    </Card.Card>

    <Card.Card>
      <Card.CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <Card.CardTitle class="text-sm font-medium">Queue Length</Card.CardTitle>
        <Activity class="h-4 w-4 text-muted-foreground" />
      </Card.CardHeader>
      <Card.CardContent>
        <div class="text-2xl font-bold">
          {#if $metricsQuery.data}
            {$metricsQuery.data.queue_length}
          {:else}
            0
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">Pending jobs</p>
      </Card.CardContent>
    </Card.Card>
  </div>

  <!-- Sessions List -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold tracking-tight">Recent Sessions</h2>

    {#if mockSessions.length === 0}
      <Card.Card>
        <Card.CardContent class="p-12 text-center">
          <Monitor class="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 class="mt-4 text-lg font-semibold">No sessions yet</h3>
          <p class="mt-2 text-sm text-muted-foreground">
            Create your first coding session to get started
          </p>
          <Button.Button class="mt-4" onclick={createSession}>
            <Plus class="mr-2 h-4 w-4" />
            Create Session
          </Button.Button>
        </Card.CardContent>
      </Card.Card>
    {:else}
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each mockSessions as session}
          <Card.Card class="cursor-pointer hover:shadow-md transition-shadow" onclick={() => openSession(session.id)}>
            <Card.CardHeader>
              <div class="flex items-center gap-2 mb-2">
                <div class="h-2 w-2 rounded-full {getSessionStatusColor(session.status)}"></div>
                <span class="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                  {session.status}
                </span>
                <span class="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                  {session.environment}
                </span>
              </div>
              <Card.CardTitle class="text-base truncate">{session.initial_prompt}</Card.CardTitle>
              <Card.CardDescription>
                Created {new Date(session.created_at).toLocaleString()}
              </Card.CardDescription>
            </Card.CardHeader>
            <Card.CardContent>
              <div class="flex gap-2">
                <Button.Button size="sm" variant="outline">
                  <Monitor class="mr-2 h-3 w-3" />
                  VNC
                </Button.Button>
                <Button.Button size="sm" variant="ghost">
                  View Details
                </Button.Button>
              </div>
            </Card.CardContent>
          </Card.Card>
        {/each}
      </div>
    {/if}
  </div>
</div>