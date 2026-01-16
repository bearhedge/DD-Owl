# DD Owl Work Progress

**Last Updated:** 2026-01-13 15:30
**Session:** Debugging LLM API issues for triage

---

## Current State

### Problem Being Solved
The triage system (classifies search results as RED/YELLOW/GREEN) was failing with LLM API errors.

### Root Cause Found
**Kimi/Moonshot API** was rejecting requests containing sensitive due diligence keywords (谋杀, 强奸, 黑手党, etc.) with error:
```
"The request was rejected because it was considered high risk"
```

### Solution Attempted
Switched from Kimi to **DeepSeek API** which is less censored for professional use cases.

### Current Issue
DeepSeek returns "parse failed" for triage responses. Added logging to diagnose - need to check Cloud Run logs after running a test.

---

## Files Modified

### `/src/triage.ts`
- Added DeepSeek support (uses DeepSeek if `DEEPSEEK_API_KEY` is set, falls back to Kimi)
- Increased timeout to 120 seconds for large batches
- Added logging to see actual LLM response
- Updated triage prompt to check if subject name appears first

### `/src/analyzer.ts`
- Same DeepSeek/Kimi fallback logic added

---

## Environment Variables (Cloud Run)

```
DEEPSEEK_API_KEY=sk-d81d7628a8fe4089b46bd4b38a841871
KIMI_API_KEY=(in secrets)
SERPER_API_KEY=(in secrets)
DATABASE_URL=postgresql://...
```

---

## Deployment Info

- **Service:** ddowl
- **Region:** asia-east1
- **Latest Revision:** ddowl-00038-nxb
- **URL:** https://ddowl.com (custom domain) or https://ddowl-397870885229.asia-east1.run.app

---

## Next Steps

1. **Run a test screening** at https://ddowl.com with "谈最"
2. **Check Cloud Run logs** for the triage LLM response:
   ```bash
   gcloud run services logs read ddowl --region asia-east1 --limit 100 | grep -i "triage\|response"
   ```
3. **Diagnose parse failure** - see what DeepSeek actually returns
4. **Fix based on evidence** - might need to:
   - Adjust prompt format for DeepSeek
   - Handle markdown code blocks in response
   - Switch to OpenAI if DeepSeek doesn't work

---

## Alternative LLM Options (if DeepSeek fails)

| Provider | Model | Pricing | Notes |
|----------|-------|---------|-------|
| DeepSeek | deepseek-chat | ~$0.14/M tokens | Current - less censored |
| OpenAI | gpt-4o-mini | ~$0.15/M tokens | Very reliable, good Chinese |
| OpenAI | gpt-3.5-turbo | ~$0.50/M tokens | Reliable fallback |
| Anthropic | claude-3-haiku | ~$0.25/M tokens | Nuanced moderation |

---

## Key Code Snippets

### LLM Configuration (triage.ts & analyzer.ts)
```typescript
// LLM Configuration - supports DeepSeek (preferred) or Kimi fallback
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';

const LLM_API_KEY = DEEPSEEK_API_KEY || KIMI_API_KEY;
const LLM_URL = DEEPSEEK_API_KEY
  ? 'https://api.deepseek.com/v1/chat/completions'
  : 'https://api.moonshot.ai/v1/chat/completions';
const LLM_MODEL = DEEPSEEK_API_KEY ? 'deepseek-chat' : 'moonshot-v1-8k';
```

### Check Logs Command
```bash
gcloud run services logs read ddowl --region asia-east1 --limit 100 2>&1 | grep -i "triage LLM response"
```

---

## Commands to Resume Work

```bash
# Check deployment status
gcloud run services describe ddowl --region asia-east1

# View recent logs
gcloud run services logs read ddowl --region asia-east1 --limit 50

# Rebuild and deploy
cd "/Users/home/Desktop/DD Owl/ddowl"
npm run build && gcloud run deploy ddowl --source . --region asia-east1 --allow-unauthenticated --timeout=900 --memory=1Gi

# Test DeepSeek API directly
curl -s "https://api.deepseek.com/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-d81d7628a8fe4089b46bd4b38a841871" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}],"temperature":0.1}'
```
