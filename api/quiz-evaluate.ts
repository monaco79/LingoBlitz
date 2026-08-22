import { getAIClient } from './_lib/ai';

export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const { articleContent, question, userAnswer, language, level } = await req.json();

        const LEVEL_DESCRIPTIONS = {
            'Absolute Beginner': "Use only the most basic 20-50 words and simple 'Subject-Verb-Object' sentences in the present tense. Avoid complex grammar entirely.",
            'A1': "Focus on present tense, basic adjectives, and common nouns related to daily life. Use short, simple sentences.",
            'A2': "Continue with simple sentences but introduce the simple past tense (e.g., 'I went', 'she saw'). Expand vocabulary to common situations.",
            'B1': "Introduce past and future tenses, more complex sentences with conjunctions like 'because', 'so', 'but', and a wider range of everyday vocabulary.",
            'B2': "Use a mix of tenses including perfect and conditional. Introduce more nuanced vocabulary and some common idiomatic expressions. Sentences can be longer and more complex.",
            'C1': "Use advanced and nuanced vocabulary, complex grammatical structures, idiomatic expressions, and a formal or informal tone as appropriate for the topic. Assume a high level of comprehension.",
        };

        const levelDescription = LEVEL_DESCRIPTIONS[level as keyof typeof LEVEL_DESCRIPTIONS] || LEVEL_DESCRIPTIONS['B1'];

        // Keep the stable tutoring instruction separate from request-specific content.
        const systemPrompt = `You are a friendly language tutor providing quiz feedback. Evaluate both content accuracy and language quality. Be encouraging and constructive.`;

        // User prompt - contains all variables
        const userPrompt = `Evaluate this ${level} level ${language} learner's quiz answer.

Article: ${articleContent}
Question: "${question}"
Answer: "${userAnswer}"

Provide feedback in ${language}. Do NOT use a numbered list in your response. Instead, write a cohesive response covering:
- Correct/Partially correct/Incorrect
- Brief language feedback
- Gentle corrections if needed

Keep it 2-4 sentences. Use markdown emphasis for key points. Make sure to write your response in a ways adequate for a ${level} level ${language} learner.

Level guidance: ${levelDescription}`;

        const { client, model } = getAIClient();
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.4, // Using EVALUATION_TEMPERATURE from config
        });

        const feedback = response.choices[0]?.message?.content?.trim() || "Error evaluating your answer. Please try again.";

        return new Response(JSON.stringify({ feedback }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Error evaluating quiz:', error);
        return new Response(JSON.stringify({ error: 'Failed to evaluate quiz' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
