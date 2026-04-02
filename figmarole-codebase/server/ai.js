const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

function getApiKey() {
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.NVIDIA_API_KEY;
  }
  return '';
}

function callKimiAI(prompt) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reject(new Error("NVIDIA_API_KEY not found in config.json"));
    }

    const payload = JSON.stringify({
      "model": "moonshotai/kimi-k2.5",
      "messages": [
        {
          "role": "system",
          "content": "You are an expert web developer. Your task is to receive a JSON structural map of a website and return a clean, vanilla HTML/CSS version of the site. It should have no external connectivity, no complex dynamism, just a snapshot of the site after loading, matching the original visually as closely as possible using inline CSS. Provide only the raw code in a single HTML file containing inline CSS, inside a markdown code block, or just the raw HTML."
        },
        {
          "role": "user",
          "content": prompt
        }
      ],
      "max_tokens": 16384,
      "temperature": 0.2, // lower temperature for more deterministic output
      "top_p": 1.00,
      "stream": false,
      "chat_template_kwargs": {"thinking":true}
    });

    const options = {
      hostname: 'integrate.api.nvidia.com',
      path: '/v1/chat/completions',
      method: 'POST',
      timeout: 600000, // 10 minutes timeout for generation
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            const responseContent = parsed.choices[0].message.content;
            // Extract HTML from markdown code block if present
            const htmlMatch = responseContent.match(/```html\s*([\s\S]*?)```/);
            const finalHtml = htmlMatch ? htmlMatch[1] : responseContent;
            resolve(finalHtml);
          } catch (e) {
            reject(new Error("Failed to parse AI response: " + e.message));
          }
        } else {
          reject(new Error(`AI Request failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error("AI Request timed out"));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { callKimiAI, getApiKey };
