import { getAIClient } from './_lib/ai';

export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const { interests, previouslyBlitzed, count, language, level } = await req.json();

        const systemPrompt = `You are a creative language tutor. Generate ${count} interesting, specific, and engaging conversation topics for a student learning ${language} at ${level} level.
    The topics should be related to these interests: ${interests.join(', ')}.
    Do NOT suggest these topics: ${previouslyBlitzed.join(', ')}.
    
    IMPORTANT FORMATTING RULES:
    - Provide ONLY the topics, separated by a pipe character (|).
    - Each topic must be an engaging, descriptive title (2-6 words) IN THE TARGET LANGUAGE (${language}) (e.g., "The Future of Artificial Intelligence", "Sustainable Travel Tips", "My Grandmother's Secret Recipe").
    - DO NOT use questions, commands, or sentences (e.g., NO "Describe your day", NO "What is your hobby?").
    - No numbering, no extra text.`;

        const userPrompt = `Generate ${count} topics now.`;

        const { client, model } = getAIClient();
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.8,
        });

        const content = response.choices[0]?.message?.content?.trim() || "";
        const proposals = content.split('|').map(t => t.trim()).filter(t => t.length > 0);

        return new Response(JSON.stringify({ proposals }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Error generating proposals:', error);
        return new Response(JSON.stringify({ error: 'Failed to generate proposals' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
