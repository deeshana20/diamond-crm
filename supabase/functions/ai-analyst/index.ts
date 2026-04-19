const DEFAULT_ALLOWED_ORIGINS = [
  "null",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

function getAllowedOrigins() {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function resolveCorsHeaders(origin: string | null) {
  const allowedOrigins = getAllowedOrigins();
  const isAllowed = origin ? allowedOrigins.includes(origin) : allowedOrigins.includes("null");

  return {
    "Access-Control-Allow-Origin": isAllowed ? (origin || "null") : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

async function getAuthenticatedUser(req: Request, corsHeaders: Record<string, string>) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Missing bearer token." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase auth environment variables.");
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": supabaseAnonKey,
    },
  });

  if (!userResponse.ok) {
    throw new Response(JSON.stringify({ error: "Invalid or expired user token." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return await userResponse.json();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = resolveCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = await getAuthenticatedUser(req, corsHeaders);
    if (!user?.id) {
      throw new Error("Unable to resolve authenticated user.");
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      throw new Error("The frontend sent an empty prompt to the backend.");
    }

    const apiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!apiKey) {
      throw new Error("Missing Google API Key in Vault");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `SYSTEM INSTRUCTIONS:
You are the Diamond CRM Security Analyst.
Focus: Security printing, tamper-evident seals, and fraud prevention.
Task: Analyze data or draft professional emails using the names provided.
Tone: Professional and precise.
Authenticated User ID: ${user.id}`,
                },
                {
                  text: `USER REQUEST: ${prompt}`,
                },
              ],
            },
          ],
        }),
      },
    );

    const aiData = await response.json();
    if (!response.ok || aiData.error) {
      throw new Error(`Google API Rejected: ${aiData.error?.message || response.statusText}`);
    }

    const aiResponseText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiResponseText) {
      throw new Error("Gemini returned an empty response.");
    }

    return new Response(JSON.stringify({ reply: aiResponseText, userId: user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
