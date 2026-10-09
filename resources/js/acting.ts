import { api } from "./api";
import { flashLater } from "./flash";

/**
 * An admin starts to work as a customer company, after a question. The app then loads
 * again as that customer, with a bar at the top of every page and a "Stop" button.
 * It throws what the API throws, so the page can show it.
 */
export async function actAsCustomer(company: { id: string; name: string }): Promise<void> {
  const question = `Act as ${company.name}? You will work in their account: projects, catalog and orders. Their users get a notification with your name.`;
  if (!confirm(question)) {
    return;
  }
  const auth = await api.actAs(company.id);
  flashLater(`You now act as ${auth.user.companyName}. Click "Stop" at the top when you are done.`);
  // A full load: every page starts again as the customer.
  window.location.assign("/dashboard");
}
