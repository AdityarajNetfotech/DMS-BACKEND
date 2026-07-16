const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extracts text from local or remote file
 */
async function extractText(storageUrl, mimeType) {
  try {
    let buffer;
    let filePath;

    if (storageUrl.includes('/uploads/')) {
      const parts = storageUrl.split('/uploads/');
      const fileName = parts[parts.length - 1];
      filePath = path.join(__dirname, '../../uploads', fileName);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Local file not found at ${filePath}`);
      }
      buffer = fs.readFileSync(filePath);
    } else if (storageUrl.startsWith('/uploads')) {
      filePath = path.join(__dirname, '../../', storageUrl);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Local file not found at ${filePath}`);
      }
      buffer = fs.readFileSync(filePath);
    } else {
      // Remote URL (e.g. Cloudinary)
      const response = await fetch(storageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download remote file. Status: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const typeLower = (mimeType || '').toLowerCase();
    const urlWithoutQuery = storageUrl.split('?')[0];
    const ext = path.extname(urlWithoutQuery || '').toLowerCase();

    if (typeLower.includes('pdf') || ext === '.pdf') {
      const parsed = await pdf(buffer);
      return parsed.text || '';
    } else if (
      typeLower.includes('word') ||
      typeLower.includes('officedocument.wordprocessingml') ||
      ext === '.docx' ||
      ext === '.doc'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } else if (
      typeLower.includes('text') ||
      typeLower.includes('json') ||
      typeLower.includes('javascript') ||
      typeLower.includes('csv') ||
      ext === '.txt' ||
      ext === '.md' ||
      ext === '.json' ||
      ext === '.csv' ||
      ext === '.js' ||
      ext === '.html'
    ) {
      return buffer.toString('utf8');
    }

    return '';
  } catch (error) {
    console.error('Error during text extraction:', error);
    return '';
  }
}

/**
 * Sends text to AI for summarization, trying Gemini first, then falling back to OpenAI
 */
async function summarizeText(title, text, isFolder = false, headerGeminiKey = null, headerOpenAiKey = null) {
  // Trim text to avoid exceeding token limits
  const maxChars = 20000;
  const trimmedText = text.length > maxChars ? text.substring(0, maxChars) + '\n[Content Truncated due to size...]' : text;

  const prompt = isFolder
    ? `You are an AI document assistant. Below is the list of files and content previews inside the folder "${title}":\n\n${trimmedText}\n\nProvide a high-level summary of the files inside this folder, explaining what kind of documents are stored here and their main purpose. Keep it to 3-5 concise bullet points. Output only clean Markdown.`
    : `You are an AI document assistant. Summarize the contents of the document "${title}" based on the following text content:\n\n${trimmedText}\n\nProvide a summary in 3-5 concise bullet points. Output only clean Markdown.`;

  // 1. Try Gemini
  const geminiKey = headerGeminiKey || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    // Newer keys might only support Gemini 2.x or 2.5 models. We try a chain of models.
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    
    for (const model of modelsToTry) {
      try {
        console.log(`Attempting summarization with Gemini (${model})...`);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: prompt }]
              }]
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (summary) {
            return summary.trim();
          }
        } else {
          const errorText = await response.text();
          console.warn(`Gemini API (${model}) returned status ${response.status}:`, errorText);
        }
      } catch (err) {
        console.error(`Gemini API call for ${model} failed:`, err);
      }
    }
  }

  // 2. Try OpenAI Fallback
  const openAiKey = headerOpenAiKey || process.env.OPENAI_API_KEY;
  if (openAiKey) {
    try {
      console.log('Attempting summarization with OpenAI fallback...');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that summarizes documents.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content;
        if (summary) {
          return summary.trim();
        }
      } else {
        const errorText = await response.text();
        console.warn(`OpenAI API returned status ${response.status}:`, errorText);
      }
    } catch (err) {
      console.error('OpenAI API call failed:', err);
    }
  }

  throw new Error('AI Summarization failed: No configured API keys succeeded.');
}

module.exports = {
  extractText,
  summarizeText
};
