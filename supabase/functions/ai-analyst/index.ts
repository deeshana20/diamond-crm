const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt } = await req.json()
    
    // TRIPWIRE 1: Did the website actually send the data?
    if (!prompt) {
      throw new Error("The frontend sent an empty prompt to the backend.");
    }

    const apiKey = Deno.env.get('GOOGLE_API_KEY')
    if (!apiKey) {
      throw new Error("Missing Google API Key in Vault");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
  {
    parts: [
      {
        text: `SYSTEM INSTRUCTIONS: 
        You are the Diamond CRM Security Analyst. 
        Focus: Security printing, tamper-evident seals, and fraud prevention.
        Task: Analyze data or draft professional emails using the names provided.
        Tone: Professional and precise.`
      },
      { 
        text: `USER REQUEST: ${prompt}` 
      }
    ]
  }
]
        })
      }
    )

    const aiData = await response.json()
    
    // TRIPWIRE 2: Did Google reject the request? (This is where it crashed before!)
    if (aiData.error) {
      throw new Error(`Google API Rejected: ${aiData.error.message}`);
    }

    const aiResponseText = aiData.candidates[0].content.parts[0].text

    return new Response(
      JSON.stringify({ reply: aiResponseText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})