import { getAIClient } from './_lib/ai';

export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const { articleContent, language, level } = await req.json();

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
        const systemPrompt = `You are a language teacher creating comprehension questions. Generate questions that test understanding of the article content.`;

        // User prompt - contains all variables
        const userPrompt = `Based on this article, generate ONE open-ended comprehension question in ${language}.

Article:
${articleContent}

REQUIREMENTS:
1. Question must be in ${language}
2. Appropriate for ${level} level (${levelDescription})
3. Should test understanding of the main content
4. Should require a sentence or two to answer
5. Avoid yes/no questions

Return ONLY the question text, no additional formatting.`;

        const { client, model } = getAIClient();
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.5, // Using QUIZ_TEMPERATURE from config
        });

        const question = response.choices[0]?.message?.content?.trim() || "What did you learn from this article?";

        return new Response(JSON.stringify({ question }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Error generating quiz:', error);
        return new Response(JSON.stringify({ error: 'Failed to generate quiz' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
