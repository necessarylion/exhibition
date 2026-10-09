<script setup lang="ts">
import { Link, router, usePage } from "@inertiajs/vue3";
import {
  ArrowLeft,
  Bell,
  Building2,
  FolderKanban,
  History,
  Hourglass,
  House,
  Inbox,
  LayoutGrid,
  LogOut,
  Menu,
  Network,
  Package,
  Truck,
  UserCog,
  UserRound,
  Users,
  X,
} from "@lucide/vue";
import { type Component, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { AFTER_ACTING_URL, api, type Role, type User } from "./api";
import { flashLater, flashMessage, hideFlash, isLaterPage, showKeptFlash } from "./flash";
import { messageOf } from "./form-errors";
import { refreshUnread, unreadCount } from "./unread";

const props = defineProps<{
  title: string;
  /** One text for everyone, or one text per role. */
  subtitle?: string | Record<Role, string>;
  /** The roles that can open this page. Leave it out when every role can. */
  roles?: Role[];
  /** A small link above the title, like "Back to catalog". */
  back?: { href: string; label: string };
}>();

/** Tells the page who is logged in, for logic that the template slots cannot do. */
const emit = defineEmits<{ loaded: [user: User] }>();

interface MenuItem {
  label: string;
  href: string;
  icon: Component;
  /** More URLs that belong to this menu item. */
  also?: string[];
}

const HOME: MenuItem = { label: "Home", href: "/dashboard", icon: House };
const MY_ITEMS: MenuItem = { label: "My items", href: "/items", icon: Package };
const TEAM: MenuItem = { label: "Team", href: "/team", icon: UserCog };
const COMPANY: MenuItem = { label: "Company", href: "/company", icon: Building2 };
// The last menu item of every role. It shows the number of new notifications.
const NOTIFICATIONS: MenuItem = { label: "Notifications", href: "/notifications", icon: Bell };

// Add a line here when a role gets a new page.
const MENU: Record<Role, MenuItem[]> = {
  admin: [
    HOME,
    { label: "Customers", href: "/admin/customers", icon: Users },
    { label: "Suppliers", href: "/admin/suppliers", icon: Truck },
    { label: "Groups", href: "/admin/groups", icon: Network },
    { label: "Projects", href: "/admin/projects", icon: FolderKanban },
    // The orders for the items of the admin company. Every other order is inside its project.
    { label: "Orders for our items", href: "/orders", icon: Inbox },
    MY_ITEMS,
    TEAM,
    // What admins did while they acted as a customer.
    { label: "Admin activity", href: "/admin/activity", icon: History },
    NOTIFICATIONS,
  ],
  supplier: [
    HOME,
    { label: "Orders", href: "/orders", icon: Inbox },
    MY_ITEMS,
    TEAM,
    COMPANY,
    NOTIFICATIONS,
  ],
  customer: [
    HOME,
    // A customer opens an order from its project.
    { label: "Projects", href: "/projects", icon: FolderKanban, also: ["/orders"] },
    { label: "Catalog", href: "/catalog", icon: LayoutGrid },
    MY_ITEMS,
    TEAM,
    COMPANY,
    NOTIFICATIONS,
  ],
};

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  supplier: "Supplier",
  customer: "Customer",
};

const page = usePage();
const user = ref<User | null>(null);
const loadError = ref("");
const heading = ref<HTMLElement | null>(null);
// The menu of the top bar (tablet and phone). On a wide screen the menu is always there.
const menuOpen = ref(false);
const menuButton = ref<HTMLElement | null>(null);
const menuPanel = ref<HTMLElement | null>(null);
/** True when the page is for another role. The page then says "not found". */
const wrongRole = ref(false);
const stopping = ref(false);
// On a wide screen there is no menu button, so the menu must not stay "open" there.
let wide: MediaQueryList | undefined;

async function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) {
    await nextTick();
    menuPanel.value?.querySelector("a")?.focus();
  }
}

/** Escape closes the menu and gives the focus back to its button. */
function closeMenu() {
  if (menuOpen.value) {
    menuOpen.value = false;
    menuButton.value?.focus();
  }
}

/** A click on a menu link: the next page starts with a closed menu. */
function leaveMenu() {
  menuOpen.value = false;
}

/**
 * The screen got wide (a turned tablet, a bigger window). The menu button is gone there,
 * so an open menu is closed. Else the page behind it would stay dead.
 */
function closeWhenWide(event: MediaQueryListEvent) {
  if (event.matches) {
    menuOpen.value = false;
  }
}

/** The "Skip to menu" link: opens the menu on a small screen and goes to its first link. */
async function goToMenu() {
  if (menuButton.value && getComputedStyle(menuButton.value).display !== "none") {
    menuOpen.value = true;
  }
  await nextTick();
  menuPanel.value?.querySelector("a")?.focus();
}

/** After a move inside the app the title gets the focus, so a screen reader reads the new page. */
function start() {
  if (isLaterPage()) {
    heading.value?.focus();
  }
  showKeptFlash();
  wide = window.matchMedia("(min-width: 901px)");
  wide.addEventListener("change", closeWhenWide);
  window.addEventListener("storage", otherTabChanged);
  return loadUser();
}

function end() {
  wide?.removeEventListener("change", closeWhenWide);
  window.removeEventListener("storage", otherTabChanged);
}

/** Another tab logged in or out, or started or stopped acting. This page loads again. */
function otherTabChanged(event: StorageEvent) {
  api.otherTabChanged(event);
}

// The server cannot see the Bearer token on a page load, so the page checks it here.
// The API is the real protection: without a valid token and role it returns no data.
async function loadUser() {
  if (!api.getToken()) {
    router.visit("/login");
    return;
  }
  try {
    const loaded = await api.me();
    user.value = loaded;
    // A page of another role is not a page of this user. It says so, like any wrong URL.
    if (props.roles && !props.roles.includes(loaded.role)) {
      wrongRole.value = true;
      return;
    }
    emit("loaded", loaded);
    // The bell count is asked on every page load. It does not hold the page back.
    void refreshUnread();
  } catch (caught) {
    // A dead token (401) already went to the login page. Any other error, like a
    // network drop, is no reason to log the user out.
    loadError.value = messageOf(caught);
  }
}

function reload() {
  window.location.reload();
}

function isCurrent(item: MenuItem): boolean {
  for (const href of [item.href, ...(item.also ?? [])]) {
    if (page.url.startsWith(href)) {
      return true;
    }
  }
  return false;
}

function subtitleFor(role: Role): string | undefined {
  return typeof props.subtitle === "object" ? props.subtitle[role] : props.subtitle;
}

async function logout() {
  await api.logout();
  flashLater("You are logged out.");
  router.visit("/login");
}

/** The admin stops acting as the customer and is back in the own account. */
async function stopActing() {
  stopping.value = true;
  const company = user.value?.companyName ?? "the customer";
  if (await api.stopActing()) {
    flashLater(`You stopped acting as ${company}.`);
    // A full load: every page starts again as the admin.
    window.location.assign(AFTER_ACTING_URL);
  } else {
    // Nobody acts in this browser any more: another tab stopped it or logged in again.
    // Nothing was changed. The page loads again and shows who is logged in now.
    window.location.assign("/dashboard");
  }
}

onMounted(start);
onBeforeUnmount(end);
</script>

<template>
  <a href="#content" class="skip-link">Skip to content</a>
  <a v-if="user" href="#main-menu" class="skip-link" @click.prevent="goToMenu">Skip to menu</a>
  <!-- An admin who works in the account of a customer sees this on every page. -->
  <div v-if="user?.actingAdmin" class="acting-bar" role="status">
    <UserRound :size="18" aria-hidden="true" />
    <span>
      You are acting as <strong>{{ user.companyName }}</strong> ({{ user.name }}).
    </span>
    <button type="button" class="secondary" :disabled="stopping" @click="stopActing">Stop</button>
  </div>
  <div class="app" :class="{ acting: user?.actingAdmin }">
    <aside class="sidebar" :class="{ open: menuOpen }" @keydown.esc="closeMenu">
      <div class="topbar">
        <span class="brand">Exhibition</span>
        <button
          v-if="user"
          ref="menuButton"
          type="button"
          class="menu-button"
          aria-controls="main-menu"
          :aria-expanded="menuOpen"
          :aria-label="menuOpen ? 'Close menu' : 'Open menu'"
          @click="toggleMenu"
        >
          <component :is="menuOpen ? X : Menu" :size="24" aria-hidden="true" />
        </button>
      </div>
      <div id="main-menu" ref="menuPanel" class="menu-panel">
        <nav v-if="user" aria-label="Main">
          <Link
            v-for="item in MENU[user.role]"
            :key="item.href"
            :href="item.href"
            :aria-current="isCurrent(item) ? 'page' : undefined"
            @click="leaveMenu"
          >
            <component :is="item.icon" :size="18" aria-hidden="true" />
            {{ item.label }}
            <span v-if="item === NOTIFICATIONS && unreadCount > 0" class="menu-count">
              {{ unreadCount > 99 ? "99+" : unreadCount }}
              <span class="sr-only">new</span>
            </span>
          </Link>
        </nav>
        <div v-if="user" class="account">
          <Link
            href="/profile"
            title="My profile"
            :aria-current="page.url.startsWith('/profile') ? 'page' : undefined"
            @click="leaveMenu"
          >
            <strong>{{ user.name }}</strong>
            {{ user.companyName }} · {{ ROLE_LABELS[user.role] }}
          </Link>
          <button type="button" class="ghost" aria-label="Log out" title="Log out" @click="logout">
            <LogOut :size="16" aria-hidden="true" />
            <span class="logout-text" aria-hidden="true">Log out</span>
          </button>
        </div>
      </div>
    </aside>
    <!-- While the menu covers the page, the page behind it takes no focus and no clicks. -->
    <main id="content" class="content" :inert="menuOpen">
      <header class="page-header">
        <div>
          <Link v-if="back && !wrongRole" :href="back.href" class="back-link">
            <ArrowLeft :size="14" aria-hidden="true" /> {{ back.label }}
          </Link>
          <div class="title-row">
            <h1 ref="heading" tabindex="-1">{{ wrongRole ? "Page not found" : title }}</h1>
            <slot v-if="user && !wrongRole" name="badge" />
          </div>
          <p v-if="wrongRole" class="muted">This page does not exist, or it is not for you.</p>
          <p v-else-if="user && subtitleFor(user.role)" class="muted">
            {{ subtitleFor(user.role) }}
          </p>
        </div>
        <div v-if="user && !wrongRole" class="inline actions">
          <slot name="actions" :user="user" />
        </div>
      </header>
      <!-- A supplier that signed up by itself sees this on every page until an admin approves it. -->
      <div v-if="user && !user.companyApproved" class="notice waiting" role="status">
        <Hourglass :size="18" aria-hidden="true" />
        <span class="two-lines">
          <strong>Your company is waiting for approval.</strong>
          <span>You can add items now. Customers see them after the admin approves you.</span>
        </span>
      </div>
      <div v-if="wrongRole"><Link href="/dashboard" class="button">Go to Home</Link></div>
      <slot v-else-if="user" :user="user" />
      <div v-else-if="loadError" class="state">
        <p class="error" role="alert">Could not load your account. {{ loadError }}</p>
        <button type="button" class="secondary" @click="reload">Try again</button>
      </div>
      <p v-else class="muted" role="status">Loading…</p>
    </main>
    <!-- The message after an action, like "Saved." The region is always there, so a screen
         reader reads the text when it comes. -->
    <div class="toast" role="status">
      <template v-if="flashMessage">
        <span>{{ flashMessage }}</span>
        <button type="button" aria-label="Close the message" @click="hideFlash">
          <X :size="16" aria-hidden="true" />
        </button>
      </template>
    </div>
  </div>
</template>
