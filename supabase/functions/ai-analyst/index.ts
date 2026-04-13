// 1. Set up CORS so your GitHub Pages site is allowed to talk to this function
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle the security "handshake" before the actual request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Grab the data (prompt) sent from your frontend script.js
    const { prompt } = await req.json()

    // 3. Securely pull your Google API Key out of the Supabase Vault
    const apiKey = Deno.env.get('GOOGLE_API_KEY')
    if (!apiKey) {
      throw new Error("Missing Google API Key in Vault")
    }

    // 4. Send the data to Google's Gemini AI
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      }
    )

    const aiData = await response.json()
    
    // 5. Extract the actual text answer from Gemini's response
    const aiResponseText = aiData.candidates[0].content.parts[0].text

    // 6. Send the strategy back to your Diamond CRM dashboard
    return new Response(
      JSON.stringify({ reply: aiResponseText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    // If anything fails, send the error back cleanly
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})