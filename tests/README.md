# E2E Testing with Playwright

## Installation and Configuration

Playwright tests are configured to test the Construction Map user interface, particularly the interactive map functionality.

### Available Commands

```bash
# Run all tests
bun run test:e2e

# Test with UI interface
bun run test:e2e:ui

# Debug mode for test development
bun run test:e2e:debug

# Install Playwright browsers
bunx playwright install
```

## Test Structure

### Tests by Feature

1. **`map-mode-switching.spec.ts`** - Switching between view/edit modes
2. **`marker-filtering.spec.ts`** - Marker filtering by status
3. **`overlay-loading.spec.ts`** - Conditional image loading based on zoom
4. **`overlay-interactions.spec.ts`** - Overlay interactions
5. **`map-functionality.spec.ts`** - Basic map functionality
6. **`comprehensive-map.spec.ts`** - Complete workflow tests
7. **`auth/authentication.spec.ts`** - Authentication-dependent features

### Test Helpers

**`helpers/map-helpers.ts`** contains utilities for:
- Waiting for map initialization
- Switching between modes
- Managing zoom and navigation
- Counting markers by color
- Testing filters

**`helpers/auth-helpers.ts`** contains utilities for:
- Authentication state management
- Login/logout functionality
- Testing authenticated vs public features

## Key Features Tested

### View Mode vs Edit Mode

**View Mode (Consultation):**
- Colors based on construction timeline
- Green: future projects (not started)
- Orange: current projects (in progress)
- Grey: completed projects

**Edit Mode:**
- Colors based on overlay state
- Green: remote overlay not modified
- Orange: remote overlay modified locally
- Red: local overlay with changes
- Blue: new overlay without changes
- Purple: replacement overlay

### Conditional Image Loading

- Images load only above a zoom threshold
- Images unload when zooming out
- Loading error handling

### Marker Filtering

- Buttons to show/hide projects by status
- Filter persistence during mode changes
- Visual impact on map and sidebar

### Authentication-Dependent Features

- Public features (map viewing, basic navigation)
- Authenticated features (My Contributions, overlay creation)
- Graceful handling when not authenticated

## Test Prerequisites

1. **Frontend running:** `bun run dev-front` on port 5173
2. **Backend optional:** Many tests work without backend (navigation, zoom, filters)  
3. **Test data:** Tests adapt to available content
4. **Authentication setup:** Configure your real credentials for full feature testing

## Quick Start with Authentication

```bash
# 1. Install Playwright
bunx playwright install

# 2. Setup your credentials interactively
bun run test:setup-auth

# 3. Start frontend
bun run dev-front

# 4. Run tests (in another terminal)
bun run test:e2e
```

## Authentication Strategy

Tests are designed to work in multiple scenarios:

1. **Public mode:** Tests basic map functionality available to all users
2. **Authenticated mode:** Tests additional features for logged-in users
3. **Fallback mode:** If authentication fails, tests continue with public features

### Test User Setup

```typescript
// Example authenticated test
test('should work with authentication', async ({ page }) => {
  const authHelpers = new AuthTestHelpers(page);
  const authSuccess = await authHelpers.setupAuthenticatedState();
  
  if (authSuccess) {
    // Test authenticated features
  } else {
    // Test public features
  }
});
```

## Usage Examples

```bash
# Setup credentials (interactive)
bun run test:setup-auth

# Test specific file
bunx playwright test tests/e2e/map/map-mode-switching.spec.ts

# Test with UI
bunx playwright test --ui tests/e2e/map/

# Debug mode
bunx playwright test --debug tests/e2e/map/comprehensive-map.spec.ts

# Test only authenticated features (uses your login)
bun run test:auth-only

# Test only public features (no login)
bun run test:public-only

# Test authentication features
bunx playwright test tests/e2e/auth/
```

## Authentication Commands

```bash
# Setup your real credentials
bun run test:setup-auth

# Test with authentication (recommended)
bun run test:auth-only

# Test without authentication
bun run test:public-only

# All tests (both authenticated and public)
bun run test:e2e
```

## Suggested Improvements

To make tests more robust, consider adding `data-testid` attributes to critical components:

```vue
<!-- In Vue components -->
<div class="overlay-item" data-testid="overlay-item">
<button data-testid="filter-not-started">Toggle not started projects</button>
<div class="info-popup" data-testid="info-popup">
<div class="auth-modal" data-testid="auth-modal">
<div class="user-menu" data-testid="user-menu">
```

This approach makes tests more resilient to CSS or structural changes.