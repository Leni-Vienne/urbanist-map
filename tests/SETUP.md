# Playwright Test Setup with Authentication

## Quick Setup

1. **Install dependencies:**
```bash
bun install
bunx playwright install
```

2. **Configure your credentials:**
```bash
# Copy the template
cp .env.test .env.test.local

# Edit .env.test.local with your actual credentials
```

3. **Add your real credentials to `.env.test.local`:**
```env
TEST_USER_EMAIL=your.real.email@domain.com
TEST_USER_PASSWORD=YourActualPassword
TEST_BASE_URL=http://localhost:5173
```

4. **Run tests:**
```bash
# Start frontend first
bun run dev-front

# In another terminal, run tests
bun run test:e2e
```

## How Authentication Works

### Automatic Login
- **Global Setup:** Playwright logs in with your credentials once before all tests
- **State Persistence:** Login session is saved to `tests/auth-state.json`
- **Reuse:** All tests use the same authenticated session

### Test Projects
- **`chromium`** - Uses authenticated state (your real login)
- **`chromium-unauthenticated`** - Tests public features without login
- **`firefox`** - Also uses authenticated state

### Environment Variables
- **`TEST_USER_EMAIL`** - Your real email for login
- **`TEST_USER_PASSWORD`** - Your real password
- **`TEST_BASE_URL`** - Frontend URL (usually localhost:5173)
- **`TEST_BACKEND_URL`** - Backend URL (if needed)

## Usage Examples

```bash
# Run all tests (authenticated + unauthenticated)
bun run test:e2e

# Run only authenticated tests
bunx playwright test --project=chromium

# Run only unauthenticated tests  
bunx playwright test --project=chromium-unauthenticated

# Test specific authenticated features
bunx playwright test tests/e2e/authenticated/

# Debug with UI
bun run test:e2e:ui
```

## Security Notes

- ⚠️ **Never commit `.env.test.local`** - Contains real credentials
- ✅ **Safe:** `.env.test` is committed (template only)
- ✅ **Safe:** `tests/auth-state.json` is gitignored
- 🔒 **Recommendation:** Use a dedicated test account, not your main account

## Troubleshooting

### Login Fails
- Check credentials in `.env.test.local`
- Verify frontend is running on correct port
- Check console output for auth errors

### No Authenticated Features
- Verify `tests/auth-state.json` was created during global setup
- Check if backend is running for auth verification
- Try deleting `auth-state.json` to force re-authentication

### Tests Don't See Changes
- Clear browser storage: `rm tests/auth-state.json`
- Restart Playwright to re-run global setup
- Verify environment variables are loaded correctly