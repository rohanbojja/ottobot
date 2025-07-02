<script lang="ts">
  import { Plus, Activity, Zap, Monitor, Trash2, ExternalLink, Users } from "@lucide/svelte";
  import * as Button from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { getSessionStatusColor } from "$lib/utils.js";
  import { createHealthQuery, createMetricsQuery, createSessionMutation, createDeleteSessionMutation, sessionApi } from "$lib/api/queries.js";
  import { createQuery } from "@tanstack/svelte-query";

  // Use real API queries
  const healthQuery = createHealthQuery();
  const metricsQuery = createMetricsQuery();
  const sessionMutation = createSessionMutation();
  const deleteSessionMutation = createDeleteSessionMutation();
  const sessionsQuery = createQuery({
    queryKey: ['sessions'],
    queryFn: () => sessionApi.listSessions({ limit: 10 }),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  let isCreating = $state(false);

  let createPrompt = $state('');
  let showCreateDialog = $state(false);
  
  async function createSession() {
    if (!createPrompt.trim()) {
      createPrompt = "Help me build a web application";
    }
    
    isCreating = true;
    try {
      await $sessionMutation.mutateAsync({
        initial_prompt: createPrompt.trim(),
        environment: "node",
      });
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      isCreating = false;
      showCreateDialog = false;
      createPrompt = '';
    }
  }

  function openSession(sessionId: string) {
    window.location.href = `/session/${sessionId}`;
  }

  async function deleteSession(sessionId: string, event: Event) {
    event.stopPropagation(); // Prevent card click
    if (confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
      try {
        await $deleteSessionMutation.mutateAsync(sessionId);
        $sessionsQuery.refetch(); // Refresh the list
      } catch (error) {
        console.error('Failed to delete session:', error);
        alert('Failed to delete session. Please try again.');
      }
    }
  }

  function openVNC(vncUrl: string, event: Event) {
    event.stopPropagation(); // Prevent card click
    window.open(vncUrl, '_blank');
  }
  
  // Refresh session list after creating a new session
  $effect(() => {
    if ($sessionMutation.isSuccess) {
      $sessionsQuery.refetch();
      // Navigate to the new session
      if ($sessionMutation.data?.session_id) {
        openSession($sessionMutation.data.session_id);
      }
    }
  });
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
    <Button.Button onclick={() => showCreateDialog = true}>
      <Plus class="mr-2 h-4 w-4" />
      New Session
    </Button.Button>
  </div>

  <!-- Stats Cards -->
  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
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

    <Card.Card>
      <Card.CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <Card.CardTitle class="text-sm font-medium">Connected Workers</Card.CardTitle>
        <Users class="h-4 w-4 text-muted-foreground" />
      </Card.CardHeader>
      <Card.CardContent>
        <div class="text-2xl font-bold">
          {#if $metricsQuery.data}
            {$metricsQuery.data.worker_status?.filter(w => w.active).length || 0}
          {:else}
            0
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">
          {#if $metricsQuery.data && $metricsQuery.data.worker_status}
            {$metricsQuery.data.worker_status.reduce((sum, w) => sum + w.current_jobs, 0)} active jobs
          {:else}
            Active workers
          {/if}
        </p>
      </Card.CardContent>
    </Card.Card>
  </div>

  <!-- Worker Status -->
  {#if $metricsQuery.data && $metricsQuery.data.worker_status && $metricsQuery.data.worker_status.length > 0}
    <div class="space-y-4 mb-8">
      <h2 class="text-xl font-semibold tracking-tight">Worker Status</h2>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each $metricsQuery.data.worker_status as worker}
          <Card.Card>
            <Card.CardHeader class="pb-2">
              <div class="flex items-center justify-between">
                <Card.CardTitle class="text-sm font-medium">
                  {worker.id}
                </Card.CardTitle>
                <div class="flex items-center gap-2">
                  <div class="h-2 w-2 rounded-full {worker.active ? 'bg-green-500' : 'bg-red-500'}"></div>
                  <span class="text-xs text-muted-foreground">
                    {worker.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </Card.CardHeader>
            <Card.CardContent>
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">Current Jobs:</span>
                <span class="font-medium">{worker.current_jobs}</span>
              </div>
            </Card.CardContent>
          </Card.Card>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Sessions List -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold tracking-tight">Recent Sessions</h2>

    {#if $sessionsQuery.isLoading}
      <Card.Card>
        <Card.CardContent class="p-12 text-center">
          <Monitor class="mx-auto h-12 w-12 text-muted-foreground animate-pulse" />
          <h3 class="mt-4 text-lg font-semibold">Loading sessions...</h3>
        </Card.CardContent>
      </Card.Card>
    {:else if $sessionsQuery.error}
      <Card.Card>
        <Card.CardContent class="p-12 text-center">
          <Monitor class="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 class="mt-4 text-lg font-semibold">Error loading sessions</h3>
          <p class="mt-2 text-sm text-muted-foreground">
            {$sessionsQuery.error.message}
          </p>
        </Card.CardContent>
      </Card.Card>
    {:else if !$sessionsQuery.data?.sessions || $sessionsQuery.data.sessions.length === 0}
      <Card.Card>
        <Card.CardContent class="p-12 text-center">
          <Monitor class="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 class="mt-4 text-lg font-semibold">No sessions yet</h3>
          <p class="mt-2 text-sm text-muted-foreground">
            Create your first coding session to get started
          </p>
          <Button.Button class="mt-4" onclick={() => showCreateDialog = true}>
            <Plus class="mr-2 h-4 w-4" />
            Create Session
          </Button.Button>
        </Card.CardContent>
      </Card.Card>
    {:else}
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each $sessionsQuery.data.sessions as session}
          <Card.Card class="cursor-pointer hover:shadow-md transition-shadow" onclick={() => openSession(session.session_id)}>
            <Card.CardHeader>
              <div class="flex items-center gap-2 mb-2">
                <div class="h-2 w-2 rounded-full {getSessionStatusColor(session.status)}"></div>
                <span class="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                  {session.status}
                </span>
              </div>
              <Card.CardTitle class="text-base truncate">{session.initial_prompt || 'Coding Session'}</Card.CardTitle>
              <Card.CardDescription>
                Created {new Date(session.created_at).toLocaleString()}
              </Card.CardDescription>
            </Card.CardHeader>
            <Card.CardContent>
              <div class="flex gap-2 justify-between">
                <div class="flex gap-2">
                  <Button.Button 
                    size="sm" 
                    variant="outline"
                    onclick={(e) => openVNC(session.vnc_url, e)}
                    disabled={session.status !== 'ready' && session.status !== 'running'}
                  >
                    <ExternalLink class="mr-2 h-3 w-3" />
                    VNC
                  </Button.Button>
                  <Button.Button size="sm" variant="ghost">
                    View Details
                  </Button.Button>
                </div>
                <Button.Button 
                  size="sm" 
                  variant="ghost"
                  onclick={(e) => deleteSession(session.session_id, e)}
                  disabled={$deleteSessionMutation.isPending}
                  class="text-destructive hover:text-destructive"
                >
                  <Trash2 class="h-3 w-3" />
                </Button.Button>
              </div>
            </Card.CardContent>
          </Card.Card>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Create Session Dialog -->
{#if showCreateDialog}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onclick={(e) => {
    if (e.target === e.currentTarget) showCreateDialog = false;
  }}>
    <Card.Card class="w-full max-w-md">
      <Card.CardHeader>
        <Card.CardTitle>Create New Session</Card.CardTitle>
        <Card.CardDescription>
          Tell the AI what you want to build
        </Card.CardDescription>
      </Card.CardHeader>
      <Card.CardContent>
        <div class="space-y-4">
          <div>
            <label for="prompt" class="text-sm font-medium">Initial Prompt</label>
            <textarea
              id="prompt"
              bind:value={createPrompt}
              placeholder="e.g., Help me build a React todo app with TypeScript and Tailwind CSS"
              class="mt-1 w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onkeydown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  createSession();
                }
              }}
            />
            <p class="mt-1 text-xs text-muted-foreground">
              Press Ctrl+Enter to create
            </p>
          </div>
        </div>
      </Card.CardContent>
      <Card.CardFooter class="flex gap-2">
        <Button.Button variant="outline" onclick={() => showCreateDialog = false}>
          Cancel
        </Button.Button>
        <Button.Button onclick={createSession} disabled={isCreating}>
          {isCreating ? "Creating..." : "Create Session"}
        </Button.Button>
      </Card.CardFooter>
    </Card.Card>
  </div>
{/if}