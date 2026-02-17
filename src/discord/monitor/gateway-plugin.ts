import { createRequire } from "node:module";
import { GatewayIntents, GatewayPlugin } from "@buape/carbon/gateway";
import WebSocket, { type ClientOptions } from "ws";
import type { DiscordAccountConfig } from "../../config/types.js";
import type { RuntimeEnv } from "../../runtime.js";
import { danger } from "../../globals.js";

const requireFromHere = createRequire(import.meta.url);
type ProxyAgentCtor = new (proxy: string) => NonNullable<ClientOptions["agent"]>;

function resolveHttpsProxyAgentCtor(): ProxyAgentCtor | null {
  try {
    const mod = requireFromHere("https-proxy-agent") as { HttpsProxyAgent?: unknown };
    if (typeof mod.HttpsProxyAgent !== "function") {
      return null;
    }
    return mod.HttpsProxyAgent as ProxyAgentCtor;
  } catch {
    return null;
  }
}

export function resolveDiscordGatewayIntents(
  intentsConfig?: import("../../config/types.discord.js").DiscordIntentsConfig,
): number {
  let intents =
    GatewayIntents.Guilds |
    GatewayIntents.GuildMessages |
    GatewayIntents.MessageContent |
    GatewayIntents.DirectMessages |
    GatewayIntents.GuildMessageReactions |
    GatewayIntents.DirectMessageReactions;
  if (intentsConfig?.presence) {
    intents |= GatewayIntents.GuildPresences;
  }
  if (intentsConfig?.guildMembers) {
    intents |= GatewayIntents.GuildMembers;
  }
  return intents;
}

export function createDiscordGatewayPlugin(params: {
  discordConfig: DiscordAccountConfig;
  runtime: RuntimeEnv;
}): GatewayPlugin {
  const intents = resolveDiscordGatewayIntents(params.discordConfig?.intents);
  const proxy = params.discordConfig?.proxy?.trim();
  const options = {
    reconnect: { maxAttempts: 50 },
    intents,
    autoInteractions: true,
  };

  if (!proxy) {
    return new GatewayPlugin(options);
  }

  try {
    const HttpsProxyAgent = resolveHttpsProxyAgentCtor();
    if (!HttpsProxyAgent) {
      params.runtime.error?.(
        danger("discord: gateway proxy requested but https-proxy-agent is unavailable"),
      );
      return new GatewayPlugin(options);
    }
    const agent = new HttpsProxyAgent(proxy);

    params.runtime.log?.("discord: gateway proxy enabled");

    class ProxyGatewayPlugin extends GatewayPlugin {
      constructor() {
        super(options);
      }

      createWebSocket(url: string) {
        return new WebSocket(url, { agent });
      }
    }

    return new ProxyGatewayPlugin();
  } catch (err) {
    params.runtime.error?.(danger(`discord: invalid gateway proxy: ${String(err)}`));
    return new GatewayPlugin(options);
  }
}
