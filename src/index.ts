import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

// ── Railway GraphQL Client ──────────────────────────────────────────────────

const RAILWAY_API = "https://backboard.railway.app/graphql/v2";

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) throw new Error("RAILWAY_API_TOKEN environment variable is required");

  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: any) => e.message).join("; "));
  }
  return json.data;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function edgesToList(connection: any): any[] {
  if (!connection?.edges) return [];
  return connection.edges.map((e: any) => e.node);
}

function fmt(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "railway-mcp-server",
  version: "1.0.0",
});

// ── Tool: railway_me ────────────────────────────────────────────────────────

server.tool(
  "railway_me",
  "Get the authenticated Railway user profile including workspaces",
  {},
  async () => {
    const data = await gql(`
      query {
        me {
          id name email username
          workspaces {
            id name
            projects(first: 100) {
              edges { node { id name } }
            }
          }
        }
      }
    `);
    const user = data.me;
    const result = {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      workspaces: user.workspaces.map((ws: any) => ({
        id: ws.id,
        name: ws.name,
        projects: edgesToList(ws.projects),
      })),
    };
    return { content: [{ type: "text", text: fmt(result) }] };
  }
);

// ── Tool: railway_list_projects ─────────────────────────────────────────────

server.tool(
  "railway_list_projects",
  "List all projects in a workspace. If no workspaceId given, lists projects across all workspaces.",
  { workspaceId: z.string().optional().describe("Filter by workspace ID") },
  async ({ workspaceId }) => {
    const data = await gql(`
      query {
        me {
          workspaces {
            id name
            projects(first: 100) {
              edges {
                node {
                  id name description createdAt updatedAt
                  services(first: 50) { edges { node { id name } } }
                  environments(first: 50) { edges { node { id name } } }
                }
              }
            }
          }
        }
      }
    `);

    let projects: any[] = [];
    for (const ws of data.me.workspaces) {
      if (workspaceId && ws.id !== workspaceId) continue;
      for (const p of edgesToList(ws.projects)) {
        projects.push({
          ...p,
          workspaceId: ws.id,
          workspaceName: ws.name,
          services: edgesToList(p.services),
          environments: edgesToList(p.environments),
        });
      }
    }
    return { content: [{ type: "text", text: fmt(projects) }] };
  }
);

// ── Tool: railway_get_project ───────────────────────────────────────────────

server.tool(
  "railway_get_project",
  "Get full details of a Railway project by ID, including services, environments, and volumes",
  { projectId: z.string().describe("Project ID") },
  async ({ projectId }) => {
    const data = await gql(`
      query($projectId: String!) {
        project(id: $projectId) {
          id name description createdAt updatedAt isPublic subscriptionType
          services(first: 100) {
            edges { node { id name icon createdAt updatedAt projectId } }
          }
          environments(first: 100) {
            edges { node { id name createdAt updatedAt isEphemeral } }
          }
          volumes(first: 100) {
            edges { node { id name createdAt } }
          }
        }
      }
    `, { projectId });

    const p = data.project;
    const result = {
      ...p,
      services: edgesToList(p.services),
      environments: edgesToList(p.environments),
      volumes: edgesToList(p.volumes),
    };
    return { content: [{ type: "text", text: fmt(result) }] };
  }
);

// ── Tool: railway_get_service ───────────────────────────────────────────────

server.tool(
  "railway_get_service",
  "Get details of a Railway service including recent deployments",
  { serviceId: z.string().describe("Service ID") },
  async ({ serviceId }) => {
    const data = await gql(`
      query($serviceId: String!) {
        service(id: $serviceId) {
          id name icon createdAt updatedAt projectId templateId
          deployments(first: 10) {
            edges {
              node {
                id status createdAt updatedAt url staticUrl
                environmentId serviceId
              }
            }
          }
        }
      }
    `, { serviceId });

    const s = data.service;
    return {
      content: [{
        type: "text",
        text: fmt({ ...s, deployments: edgesToList(s.deployments) }),
      }],
    };
  }
);

// ── Tool: railway_list_services ─────────────────────────────────────────────

server.tool(
  "railway_list_services",
  "List services in a Railway project",
  { projectId: z.string().describe("Project ID") },
  async ({ projectId }) => {
    const data = await gql(`
      query($projectId: String!) {
        project(id: $projectId) {
          services(first: 100) {
            edges {
              node { id name icon createdAt updatedAt projectId }
            }
          }
        }
      }
    `, { projectId });
    return { content: [{ type: "text", text: fmt(edgesToList(data.project.services)) }] };
  }
);

// ── Tool: railway_list_environments ─────────────────────────────────────────

server.tool(
  "railway_list_environments",
  "List environments in a Railway project",
  { projectId: z.string().describe("Project ID") },
  async ({ projectId }) => {
    const data = await gql(`
      query($projectId: String!) {
        project(id: $projectId) {
          environments(first: 100) {
            edges {
              node { id name createdAt updatedAt isEphemeral }
            }
          }
        }
      }
    `, { projectId });
    return { content: [{ type: "text", text: fmt(edgesToList(data.project.environments)) }] };
  }
);

// ── Tool: railway_list_deployments ──────────────────────────────────────────

server.tool(
  "railway_list_deployments",
  "List deployments for a service in an environment",
  {
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
    first: z.number().optional().default(10).describe("Number of deployments to return (default 10, max 50)"),
  },
  async ({ serviceId, environmentId, first }) => {
    const data = await gql(`
      query($input: DeploymentListInput!, $first: Int) {
        deployments(input: $input, first: $first) {
          edges {
            node {
              id status createdAt updatedAt url staticUrl
              environmentId serviceId
              meta
            }
          }
        }
      }
    `, { input: { serviceId, environmentId }, first: Math.min(first, 50) });
    return { content: [{ type: "text", text: fmt(edgesToList(data.deployments)) }] };
  }
);

// ── Tool: railway_get_deployment ────────────────────────────────────────────

server.tool(
  "railway_get_deployment",
  "Get full details of a specific deployment",
  { deploymentId: z.string().describe("Deployment ID") },
  async ({ deploymentId }) => {
    const data = await gql(`
      query($id: String!) {
        deployment(id: $id) {
          id status createdAt updatedAt url staticUrl
          environmentId serviceId projectId
          meta canRedeploy canRollback
        }
      }
    `, { id: deploymentId });
    return { content: [{ type: "text", text: fmt(data.deployment) }] };
  }
);

// ── Tool: railway_get_deploy_logs ───────────────────────────────────────────

server.tool(
  "railway_get_deploy_logs",
  "Get deploy logs for a deployment",
  {
    deploymentId: z.string().describe("Deployment ID"),
    limit: z.number().optional().default(100).describe("Max log lines (default 100, max 500)"),
  },
  async ({ deploymentId, limit }) => {
    const data = await gql(`
      query($deploymentId: String!, $limit: Int) {
        deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
          ... on Log { message severity timestamp }
        }
      }
    `, { deploymentId, limit: Math.min(limit, 500) });
    return { content: [{ type: "text", text: fmt(data.deploymentLogs) }] };
  }
);

// ── Tool: railway_get_build_logs ────────────────────────────────────────────

server.tool(
  "railway_get_build_logs",
  "Get build logs for a deployment",
  {
    deploymentId: z.string().describe("Deployment ID"),
    limit: z.number().optional().default(100).describe("Max log lines (default 100, max 500)"),
  },
  async ({ deploymentId, limit }) => {
    const data = await gql(`
      query($deploymentId: String!, $limit: Int) {
        buildLogs(deploymentId: $deploymentId, limit: $limit) {
          ... on Log { message severity timestamp }
        }
      }
    `, { deploymentId, limit: Math.min(limit, 500) });
    return { content: [{ type: "text", text: fmt(data.buildLogs) }] };
  }
);

// ── Tool: railway_list_variables ────────────────────────────────────────────

server.tool(
  "railway_list_variables",
  "List environment variables for a service in an environment",
  {
    projectId: z.string().describe("Project ID"),
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
  },
  async ({ projectId, serviceId, environmentId }) => {
    const data = await gql(`
      query($projectId: String!, $serviceId: String!, $environmentId: String!) {
        variables(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId)
      }
    `, { projectId, serviceId, environmentId });
    return { content: [{ type: "text", text: fmt(data.variables) }] };
  }
);

// ── Tool: railway_upsert_variable ───────────────────────────────────────────

server.tool(
  "railway_upsert_variable",
  "Create or update an environment variable for a service",
  {
    projectId: z.string().describe("Project ID"),
    environmentId: z.string().describe("Environment ID"),
    name: z.string().describe("Variable name"),
    value: z.string().describe("Variable value"),
    serviceId: z.string().optional().describe("Service ID (optional, for service-specific vars)"),
  },
  async ({ projectId, environmentId, name, value, serviceId }) => {
    const input: Record<string, unknown> = { projectId, environmentId, name, value };
    if (serviceId) input.serviceId = serviceId;
    const data = await gql(`
      mutation($input: VariableUpsertInput!) {
        variableUpsert(input: $input)
      }
    `, { input });
    return { content: [{ type: "text", text: `Variable "${name}" upserted successfully.` }] };
  }
);

// ── Tool: railway_delete_variable ───────────────────────────────────────────

server.tool(
  "railway_delete_variable",
  "Delete an environment variable",
  {
    projectId: z.string().describe("Project ID"),
    environmentId: z.string().describe("Environment ID"),
    name: z.string().describe("Variable name to delete"),
    serviceId: z.string().optional().describe("Service ID (optional)"),
  },
  async ({ projectId, environmentId, name, serviceId }) => {
    const input: Record<string, unknown> = { projectId, environmentId, name };
    if (serviceId) input.serviceId = serviceId;
    const data = await gql(`
      mutation($input: VariableDeleteInput!) {
        variableDelete(input: $input)
      }
    `, { input });
    return { content: [{ type: "text", text: `Variable "${name}" deleted successfully.` }] };
  }
);

// ── Tool: railway_redeploy ──────────────────────────────────────────────────

server.tool(
  "railway_redeploy",
  "Trigger a redeployment of a deployment",
  { deploymentId: z.string().describe("Deployment ID to redeploy") },
  async ({ deploymentId }) => {
    const data = await gql(`
      mutation($id: String!) {
        deploymentRedeploy(id: $id)
      }
    `, { id: deploymentId });
    return { content: [{ type: "text", text: `Redeployment triggered. New deployment: ${fmt(data.deploymentRedeploy)}` }] };
  }
);

// ── Tool: railway_restart_deployment ────────────────────────────────────────

server.tool(
  "railway_restart_deployment",
  "Restart a deployment",
  { deploymentId: z.string().describe("Deployment ID to restart") },
  async ({ deploymentId }) => {
    const data = await gql(`
      mutation($id: String!) {
        deploymentRestart(id: $id)
      }
    `, { id: deploymentId });
    return { content: [{ type: "text", text: "Deployment restarted successfully." }] };
  }
);

// ── Tool: railway_cancel_deployment ─────────────────────────────────────────

server.tool(
  "railway_cancel_deployment",
  "Cancel a running deployment",
  { deploymentId: z.string().describe("Deployment ID to cancel") },
  async ({ deploymentId }) => {
    await gql(`mutation($id: String!) { deploymentCancel(id: $id) }`, { id: deploymentId });
    return { content: [{ type: "text", text: "Deployment cancelled." }] };
  }
);

// ── Tool: railway_remove_deployment ─────────────────────────────────────────

server.tool(
  "railway_remove_deployment",
  "Remove/delete a deployment",
  { deploymentId: z.string().describe("Deployment ID to remove") },
  async ({ deploymentId }) => {
    await gql(`mutation($id: String!) { deploymentRemove(id: $id) }`, { id: deploymentId });
    return { content: [{ type: "text", text: "Deployment removed." }] };
  }
);

// ── Tool: railway_create_project ────────────────────────────────────────────

server.tool(
  "railway_create_project",
  "Create a new Railway project",
  {
    name: z.string().describe("Project name"),
    description: z.string().optional().describe("Project description"),
    workspaceId: z.string().optional().describe("Workspace ID (uses default if not specified)"),
  },
  async ({ name, description, workspaceId }) => {
    const input: Record<string, unknown> = { name };
    if (description) input.description = description;
    if (workspaceId) input.teamId = workspaceId; // Railway API uses teamId in the input
    const data = await gql(`
      mutation($input: ProjectCreateInput!) {
        projectCreate(input: $input) { id name }
      }
    `, { input });
    return { content: [{ type: "text", text: fmt(data.projectCreate) }] };
  }
);

// ── Tool: railway_delete_project ────────────────────────────────────────────

server.tool(
  "railway_delete_project",
  "Permanently delete a Railway project (IRREVERSIBLE)",
  { projectId: z.string().describe("Project ID to delete") },
  async ({ projectId }) => {
    await gql(`mutation($id: String!) { projectDelete(id: $id) }`, { id: projectId });
    return { content: [{ type: "text", text: "Project deleted." }] };
  }
);

// ── Tool: railway_update_project ────────────────────────────────────────────

server.tool(
  "railway_update_project",
  "Update a project's name or description",
  {
    projectId: z.string().describe("Project ID"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
  },
  async ({ projectId, name, description }) => {
    const input: Record<string, unknown> = {};
    if (name) input.name = name;
    if (description) input.description = description;
    const data = await gql(`
      mutation($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) { id name description }
      }
    `, { id: projectId, input });
    return { content: [{ type: "text", text: fmt(data.projectUpdate) }] };
  }
);

// ── Tool: railway_create_service ────────────────────────────────────────────

server.tool(
  "railway_create_service",
  "Create a new service in a project. Optionally from a GitHub repo or Docker image.",
  {
    projectId: z.string().describe("Project ID"),
    name: z.string().optional().describe("Service name"),
    source: z.object({
      repo: z.string().optional().describe("GitHub repo (owner/repo)"),
      image: z.string().optional().describe("Docker image (e.g., redis:latest)"),
    }).optional().describe("Service source"),
  },
  async ({ projectId, name, source }) => {
    const input: Record<string, unknown> = { projectId };
    if (name) input.name = name;
    if (source) input.source = source;
    const data = await gql(`
      mutation($input: ServiceCreateInput!) {
        serviceCreate(input: $input) { id name projectId }
      }
    `, { input });
    return { content: [{ type: "text", text: fmt(data.serviceCreate) }] };
  }
);

// ── Tool: railway_delete_service ────────────────────────────────────────────

server.tool(
  "railway_delete_service",
  "Delete a service from a project",
  { serviceId: z.string().describe("Service ID to delete") },
  async ({ serviceId }) => {
    await gql(`mutation($id: String!) { serviceDelete(id: $id) }`, { id: serviceId });
    return { content: [{ type: "text", text: "Service deleted." }] };
  }
);

// ── Tool: railway_update_service_instance ────────────────────────────────────

server.tool(
  "railway_update_service_instance",
  "Update service instance configuration: start/build commands, healthcheck, replicas, region, sleep, etc.",
  {
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
    startCommand: z.string().optional().describe("Start command"),
    buildCommand: z.string().optional().describe("Build command"),
    rootDirectory: z.string().optional().describe("Root directory"),
    healthcheckPath: z.string().optional().describe("Healthcheck endpoint path"),
    healthcheckTimeout: z.number().optional().describe("Healthcheck timeout in seconds"),
    numReplicas: z.number().optional().describe("Number of replicas"),
    sleepApplication: z.boolean().optional().describe("Enable sleep when idle"),
    region: z.string().optional().describe("Deployment region"),
    cronSchedule: z.string().optional().describe("Cron schedule for cron jobs"),
  },
  async (params) => {
    const { serviceId, environmentId, ...rest } = params;
    const input: Record<string, unknown> = { serviceId, environmentId };
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) input[k] = v;
    }
    const data = await gql(`
      mutation($input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(input: $input)
      }
    `, { input });
    return { content: [{ type: "text", text: "Service instance updated successfully." }] };
  }
);

// ── Tool: railway_create_environment ────────────────────────────────────────

server.tool(
  "railway_create_environment",
  "Create a new environment in a project (e.g., staging, production)",
  {
    projectId: z.string().describe("Project ID"),
    name: z.string().describe("Environment name"),
  },
  async ({ projectId, name }) => {
    const data = await gql(`
      mutation($input: EnvironmentCreateInput!) {
        environmentCreate(input: $input) { id name }
      }
    `, { input: { projectId, name } });
    return { content: [{ type: "text", text: fmt(data.environmentCreate) }] };
  }
);

// ── Tool: railway_delete_environment ────────────────────────────────────────

server.tool(
  "railway_delete_environment",
  "Delete an environment from a project",
  { environmentId: z.string().describe("Environment ID to delete") },
  async ({ environmentId }) => {
    await gql(`mutation($id: String!) { environmentDelete(id: $id) }`, { id: environmentId });
    return { content: [{ type: "text", text: "Environment deleted." }] };
  }
);

// ── Tool: railway_create_custom_domain ──────────────────────────────────────

server.tool(
  "railway_create_custom_domain",
  "Add a custom domain to a service",
  {
    projectId: z.string().describe("Project ID"),
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
    domain: z.string().describe("Custom domain (e.g., app.example.com)"),
    targetPort: z.number().optional().describe("Target port (optional)"),
  },
  async ({ projectId, serviceId, environmentId, domain, targetPort }) => {
    const input: Record<string, unknown> = { projectId, serviceId, environmentId, domain };
    if (targetPort !== undefined) input.targetPort = targetPort;
    const data = await gql(`
      mutation($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) { id domain }
      }
    `, { input });
    return { content: [{ type: "text", text: fmt(data.customDomainCreate) }] };
  }
);

// ── Tool: railway_create_service_domain ─────────────────────────────────────

server.tool(
  "railway_create_service_domain",
  "Generate a *.railway.app domain for a service",
  {
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
    targetPort: z.number().optional().describe("Target port (optional)"),
  },
  async ({ serviceId, environmentId, targetPort }) => {
    const input: Record<string, unknown> = { serviceId, environmentId };
    if (targetPort !== undefined) input.targetPort = targetPort;
    const data = await gql(`
      mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { id domain }
      }
    `, { input });
    return { content: [{ type: "text", text: fmt(data.serviceDomainCreate) }] };
  }
);

// ── Tool: railway_list_domains ──────────────────────────────────────────────

server.tool(
  "railway_list_domains",
  "List all domains (custom and service) for a service in an environment",
  {
    projectId: z.string().describe("Project ID"),
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
  },
  async ({ projectId, serviceId, environmentId }) => {
    const data = await gql(`
      query($projectId: String!, $serviceId: String!, $environmentId: String!) {
        domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
          serviceDomains { id domain }
          customDomains { id domain }
        }
      }
    `, { projectId, serviceId, environmentId });
    return { content: [{ type: "text", text: fmt(data.domains) }] };
  }
);

// ── Tool: railway_create_volume ─────────────────────────────────────────────

server.tool(
  "railway_create_volume",
  "Create a persistent volume for a service",
  {
    projectId: z.string().describe("Project ID"),
    serviceId: z.string().optional().describe("Service ID"),
    environmentId: z.string().optional().describe("Environment ID"),
    mountPath: z.string().describe("Mount path in the container (e.g., /data)"),
  },
  async ({ projectId, serviceId, environmentId, mountPath }) => {
    const input: Record<string, unknown> = { projectId, mountPath };
    if (serviceId) input.serviceId = serviceId;
    if (environmentId) input.environmentId = environmentId;
    const data = await gql(`
      mutation($input: VolumeCreateInput!) {
        volumeCreate(input: $input) { id name }
      }
    `, { input });
    return { content: [{ type: "text", text: fmt(data.volumeCreate) }] };
  }
);

// ── Tool: railway_delete_volume ─────────────────────────────────────────────

server.tool(
  "railway_delete_volume",
  "Delete a volume",
  { volumeId: z.string().describe("Volume ID to delete") },
  async ({ volumeId }) => {
    await gql(`mutation($id: String!) { volumeDelete(volumeId: $id) }`, { id: volumeId });
    return { content: [{ type: "text", text: "Volume deleted." }] };
  }
);

// ── Tool: railway_create_tcp_proxy ──────────────────────────────────────────

server.tool(
  "railway_create_tcp_proxy",
  "Create a TCP proxy for a service (useful for databases)",
  {
    serviceId: z.string().describe("Service ID"),
    environmentId: z.string().describe("Environment ID"),
    applicationPort: z.number().describe("Internal application port"),
  },
  async ({ serviceId, environmentId, applicationPort }) => {
    const data = await gql(`
      mutation($input: TCPProxyCreateInput!) {
        tcpProxyCreate(input: $input) { id domain proxyPort }
      }
    `, { input: { serviceId, environmentId, applicationPort } });
    return { content: [{ type: "text", text: fmt(data.tcpProxyCreate) }] };
  }
);

// ── Tool: railway_graphql (escape hatch) ────────────────────────────────────

server.tool(
  "railway_graphql",
  "Execute an arbitrary GraphQL query/mutation against the Railway API. Use for any operation not covered by other tools.",
  {
    query: z.string().describe("GraphQL query or mutation string"),
    variables: z.record(z.unknown()).optional().describe("GraphQL variables object"),
  },
  async ({ query, variables }) => {
    const data = await gql(query, variables || {});
    return { content: [{ type: "text", text: fmt(data) }] };
  }
);

// ── Express + Streamable HTTP Transport ─────────────────────────────────────

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    console.error("MCP error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "railway-mcp-server", version: "1.0.0" });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Railway MCP server listening on port ${PORT}`);
});
