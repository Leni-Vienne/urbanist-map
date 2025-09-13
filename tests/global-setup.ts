import { chromium } from '@playwright/test';
import * as dotenv from 'dotenv';

/**
 * AI : Global setup for Playwright tests
 * Handles authentication and state persistence
 */
async function globalSetup() {
  try {
    // AI : Load test environment variables
    dotenv.config({ path: '.env' });

    // AI : Skip auth setup if no credentials provided
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;

    if (!email || !password) {
      console.log('No test credentials provided - skipping authentication setup');
      return;
    }

    console.log('Setting up authenticated state for tests...');

    // AI : Setup authenticated browser state
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
      // AI : Navigate to the app
      const baseURL = process.env.TEST_BASE_URL || 'http://localhost:5173';
      await page.goto(baseURL);
      await page.waitForLoadState('networkidle');
      
      // AI : Look for sign in button in header (not in modal)
      const headerSignInButton = page.locator('#viewerDiv').getByRole('button', { name: 'Sign In' });
      
      if (await headerSignInButton.count() > 0) {
        await headerSignInButton.click();
        await page.waitForTimeout(1000);
        
        // AI : Fill login form in modal
        const emailInput = page.locator('input[type="email"]');
        const passwordInput = page.locator('input[type="password"]');
        const loginButton = page.getByRole('dialog').getByLabel('Sign In');
        
        if (await emailInput.count() > 0) {
          await emailInput.fill(email);
          await passwordInput.fill(password);
          await loginButton.click();
          
          // AI : Wait for login to complete
          await page.waitForTimeout(3000);
          
          // AI : Save authenticated state
          await page.context().storageState({ path: 'tests/auth-state.json' });
          console.log('✅ Authentication state saved successfully');
        }
      } else {
        console.log('No sign in button found - app may already be authenticated');
      }

    } catch (error) {
      console.warn('Authentication setup failed:', error);
      console.log('Tests will run without persistent authentication');
    } finally {
      await browser.close();
    }

  } catch (error) {
    console.warn('Global setup failed:', error);
    console.log('Tests will run in public mode');
  }
}

export default globalSetup;