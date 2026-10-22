'use strict';

const fs = require('node:fs/promises');

async function loadSystemPrompt(file) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Não foi possível ler o prompt do sistema em ${file}: ${error.message}`);
  }

  const prompt = content.replace(/\r\n?/g, '\n').trim();
  if (!prompt) {
    throw new Error(`O prompt do sistema em ${file} está vazio.`);
  }

  return prompt;
}

module.exports = { loadSystemPrompt };
