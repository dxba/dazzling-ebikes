
/**
 * Dazzling E-Bikes
 * Cloudflare Workers + Workers AI + R2 Object Storage
 */

import { Env, ChatMessage } from "./types";

// Extend existing environment with R2 binding
type StoreEnv = Env & {
    IMAGES: R2Bucket;
};

// Workers AI model
const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";

// Existing chatbot system prompt
const SYSTEM_PROMPT =
    "You are a helpful, friendly assistant. Provide concise and accurate responses.";

// Approved product image filenames
const ALLOWED_IMAGES = new Set([
    "hero-banner.webp",
    "urban-x1.webp",
    "mountain-pro.webp",
    "city-fold.webp",
    "desert-explorer.webp",
    "touring-elite.webp",
    "metro-lite.webp",
]);

export default {
    async fetch(
        request: Request,
        env: StoreEnv,
        ctx: ExecutionContext,
    ): Promise<Response> {

        const url = new URL(request.url);

        // ========================================
        // 1. Retrieve product images from R2
        // ========================================

        if (url.pathname.startsWith("/images/")) {

            if (request.method !== "GET") {
                return new Response("Method not allowed", {
                    status: 405,
                    headers: { Allow: "GET" },
                });
            }

            try {
                const imageName = url.pathname.slice("/images/".length);

                if (!ALLOWED_IMAGES.has(imageName)) {
                    return new Response("Image not found", {
                        status: 404,
                    });
                }
const cacheUrl = new URL(request.url);
cacheUrl.search = "";

const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET",
});

const cache = caches.default;

const cachedResponse = await cache.match(cacheKey);

if (cachedResponse) {
    const headers = new Headers(cachedResponse.headers);

    headers.set("X-Cache-Status", "HIT");

    return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers,
    });
}

                const image = await env.IMAGES.get(imageName);

                if (!image) {
                    return new Response("Image not found", {
                        status: 404,
                    });
                }

                const headers = new Headers();

                image.writeHttpMetadata(headers);

                headers.set("Content-Type", "image/webp");
                headers.set("Cache-Control", "public, max-age=3600");
                headers.set("ETag", image.httpEtag);
                headers.set("X-Content-Type-Options", "nosniff");

headers.set(
    "Cache-Control",
    "public, max-age=3600"
);

headers.set("X-Cache-Status", "MISS");

const response = new Response(image.body, {
    status: 200,
    headers,
});

ctx.waitUntil(
    cache.put(cacheKey, response.clone()).catch(error => {
        console.error("Cache write error:", String(error));
    })
);

return response;

            } catch (error) {

                console.error("R2 image error:", String(error));

                return new Response("Failed to retrieve image", {
                    status: 500,
                });
            }
        }

        // ========================================
        // 2. Serve website static assets
        // ========================================

        if (url.pathname === "/" ||
            !url.pathname.startsWith("/api/")) {

            return env.ASSETS.fetch(request);
        }

        // ========================================
        // 3. Handle AI chatbot requests
        // ========================================

        if (url.pathname === "/api/chat") {

            if (request.method === "POST") {
                return handleChatRequest(request, env);
            }

            return new Response("Method not allowed", {
                status: 405,
            });
        }

        // Unknown request
        return new Response("Not found", {
            status: 404,
        });

    },
} satisfies ExportedHandler<StoreEnv>;

// ========================================
// Workers AI chatbot
// ========================================

async function handleChatRequest(
    request: Request,
    env: StoreEnv,
): Promise<Response> {

    try {

        const { messages = [] } =
            (await request.json()) as {
                messages: ChatMessage[];
            };

        if (!messages.some((msg) => msg.role === "system")) {

            messages.unshift({
                role: "system",
                content: SYSTEM_PROMPT,
            });
        }

        const inputs = {
            messages,
            max_tokens: 1024,
            stream: true,
        } satisfies AiTextGenerationInput & { stream: true };

        const stream = await env.AI.run<typeof MODEL_ID>(
            MODEL_ID,
            inputs,
            {
                // AI Gateway will be configured later
            }
        );

        return new Response(stream, {
            headers: {
                "content-type": "text/event-stream; charset=utf-8",
                "cache-control": "no-cache",
                connection: "keep-alive",
            },
        });

    } catch (error) {

        console.error("AI error:", String(error));

        console.error(
            "AI error message:",
            error instanceof Error
                ? error.message
                : String(error)
        );

        console.error(
            "AI error stack:",
            error instanceof Error
                ? error.stack
                : ""
        );

        return new Response(
            JSON.stringify({
                error: "Failed to process request",
            }),
            {
                status: 500,
                headers: {
                    "content-type": "application/json",
                },
            }
        );
    }
}
