import { LEVEL_DESCRIPTIONS, LEVEL_WORD_COUNTS } from '../constants';
import { Level } from '../types';
import { getAIClient } from './_lib/ai';

export const config = {
    runtime: 'edge',
};

export async function POST(req: Request) {
    try {
        const { topic, settings } = await req.json();
        const level = settings.level as Level;
        const language = settings.learningLanguage;

        const levelDescription = LEVEL_DESCRIPTIONS[level] || "Simple language";
        const wordCount = LEVEL_WORD_COUNTS[level] || 100;

        const systemPrompt = `You are a helpful language tutor. Write an article about "${topic}" for a student with ${level} level in ${language}.`;

        const userPrompt = `REQUIREMENTS:
- Target level: ${level}
- Level description: ${levelDescription}
- Target word count: Approximately ${wordCount} words (Strictly adhere to this limit)
- Format: Title on first line, then newline, then article body
- Structure the article with clear paragraphs separated by double newlines
- No markdown formatting
- IMPORTANT: For Absolute Beginner, use extremely short sentences and basic vocabulary only.

Write the article now.`;

        const { client, model } = getAIClient();
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            stream: true,
        });

        // Convert the response to a ReadableStream
        const stream = new ReadableStream({
            async start(controller) {
                for await (const chunk of response) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    if (content) {
                        controller.enqueue(new TextEncoder().encode(content));
                    }
                }
                controller.close();
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
            },
        });

    } catch (error) {
        console.error('Error generating article:', error);
        return new Response(JSON.stringify({ error: 'Failed to generate article' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
