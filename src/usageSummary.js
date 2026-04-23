const COMMAND_NOT_FOUND_PATTERN = /not found|is not recognized as an internal or external command/i;

function parseInteger(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(String(value).replace(/,/g, ''), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function findTokenValue(text, labelsPattern) {
  const patterns = [
    new RegExp(`(?:${labelsPattern})\\s*tokens?\\s*[:=]?\\s*(\\d[\\d,]*)`, 'i'),
    new RegExp(`(?:${labelsPattern})\\s*[:=]?\\s*(\\d[\\d,]*)\\s*tokens?`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return parseInteger(match[1]);
    }
  }

  return null;
}

function parseUsageMetrics(text) {
  if (!text) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    };
  }

  const costMatch = text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/i);

  return {
    inputTokens: findTokenValue(text, 'input|prompt'),
    outputTokens: findTokenValue(text, 'output|completion'),
    totalTokens: findTokenValue(text, 'total|usage'),
    estimatedCostUsd: costMatch ? Number.parseFloat(costMatch[1]) : null,
  };
}

function summarizeProviderResult(provider, command, result) {
  const error = result.error;
  const stderr = result.stderr || '';
  const stdout = result.stdout || '';
  const combinedText = [stdout, stderr].filter(Boolean).join('\n');
  const commandMissing = COMMAND_NOT_FOUND_PATTERN.test(combinedText);
  const exitCode = error?.code;
  const normalizedExitCode = exitCode === undefined || exitCode === null ? '' : String(exitCode).toLowerCase();
  let status = 'ok';
  if (normalizedExitCode === 'enoent' || normalizedExitCode === '127' || commandMissing) {
    status = 'not_installed';
  } else if (error) {
    status = 'failed';
  }

  return {
    provider,
    command,
    status,
    metrics: parseUsageMetrics(combinedText),
    output: combinedText.trim(),
  };
}

module.exports = {
  parseUsageMetrics,
  summarizeProviderResult,
};
