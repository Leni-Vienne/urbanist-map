import { Page } from '@playwright/test';

/**
 * AI : Disable the help modal for the current test session
 * This prevents the modal from showing automatically on first load
 */
export async function disableHelpModal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('construction-map-help-modal-seen', 'true');
  });
}

/**
 * AI : Enable the help modal for the current test session
 * This allows the modal to show automatically on first load
 */
export async function enableHelpModal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.removeItem('construction-map-help-modal-seen');
  });
}

/**
 * AI : Close the help modal if it's currently visible
 * This is useful for tests that need to interact with the modal
 */
export async function closeHelpModalIfVisible(page: Page): Promise<void> {
  const helpModal = page.getByTestId('map-help-modal');
  
    // AI : Wait a short time to see if modal appears
    await helpModal.waitFor({ state: 'visible', timeout: 2000 });
    
    // AI : If modal is visible, close it
    const closeButton = helpModal.getByRole('button', { name: /j'ai compris|got it/i });
    await closeButton.click();
    
    // AI : Wait for modal to be hidden
    await helpModal.waitFor({ state: 'hidden', timeout: 1000 });
}