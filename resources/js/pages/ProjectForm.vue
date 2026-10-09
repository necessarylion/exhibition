<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { onMounted, ref } from "vue";
import { api, type ProjectInput } from "../api";
import { flashLater } from "../flash";
import { isMissing, messageOf, showError, useLeaveGuard } from "../form-errors";
import Layout from "../Layout.vue";
import PageState from "../PageState.vue";
import NotFound from "./NotFound.vue";

/** A number input gives a number, or "" when it is empty. */
type NumberField = number | "";

// The same page creates and edits. `/projects/<id>/edit` has an id, `/projects/new` has none.
const id = usePage().url.split("/")[2] ?? "";
const editing = id !== "new";
const title = editing ? "Edit project" : "New project";
const backUrl = editing ? `/projects/${id}` : "/projects";
const FORM_ID = "project-form";

const form = ref({
  name: "",
  venue: "",
  city: "",
  hall: "",
  boothNumber: "",
  // The user types metres. The API stores centimetres.
  boothWidthM: "" as NumberField,
  boothDepthM: "" as NumberField,
  startsOn: "",
  endsOn: "",
  setupOn: "",
  notes: "",
});
const loading = ref(editing);
/** The project is not mine, or it does not exist. */
const missing = ref(false);
const loadError = ref("");
/** "done" or "cancelled": such a project cannot change. The page says so and shows no form. */
const closed = ref("");
const error = ref("");
/** The form as it was loaded or saved last. */
let before = JSON.stringify(form.value);

function isDirty(): boolean {
  return JSON.stringify(form.value) !== before;
}

useLeaveGuard(isDirty);
const busy = ref(false);
/** True while an order waits or is accepted. Only the name and the notes can change then. */
const locked = ref(false);
// A new project cannot start in the past. `en-CA` gives the local day as YYYY-MM-DD.
const today = new Date().toLocaleDateString("en-CA");

function toMetres(cm: number | null): NumberField {
  return cm === null ? "" : cm / 100;
}

function toCm(metres: NumberField): number | null {
  return metres === "" ? null : Math.round(metres * 100);
}

async function load() {
  if (!editing) {
    return;
  }
  loadError.value = "";
  try {
    const { project } = await api.getProject(id);
    locked.value = project.eventLocked;
    closed.value =
      project.status === "done" || project.status === "cancelled" ? project.status : "";
    form.value = {
      name: project.name,
      venue: project.venue,
      city: project.city,
      hall: project.hall,
      boothNumber: project.boothNumber,
      boothWidthM: toMetres(project.boothWidthCm),
      boothDepthM: toMetres(project.boothDepthCm),
      startsOn: project.startsOn,
      endsOn: project.endsOn,
      setupOn: project.setupOn ?? "",
      notes: project.notes,
    };
    before = JSON.stringify(form.value);
  } catch (caught) {
    missing.value = isMissing(caught);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

async function save() {
  error.value = "";
  busy.value = true;
  const input: ProjectInput = {
    name: form.value.name,
    venue: form.value.venue,
    city: form.value.city,
    hall: form.value.hall,
    boothNumber: form.value.boothNumber,
    boothWidthCm: toCm(form.value.boothWidthM),
    boothDepthCm: toCm(form.value.boothDepthM),
    startsOn: form.value.startsOn,
    endsOn: form.value.endsOn,
    setupOn: form.value.setupOn || null,
    notes: form.value.notes,
  };
  try {
    const project = editing ? await api.updateProject(id, input) : await api.createProject(input);
    before = JSON.stringify(form.value);
    flashLater(editing ? "The project is saved." : "The project is created. Now add items.");
    // `replace`: the Back button does not open the filled form again.
    router.visit(`/projects/${project.id}`, { replace: !editing });
  } catch (caught) {
    error.value = showError(caught);
    // Only a failure gives the button back. After a success the next page is loading,
    // and a second click must not create a second project.
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
  <Head :title="`${title} · Projects`" />
  <Layout
    :title="title"
    :subtitle="
      editing
        ? 'Change the facts of the event.'
        : 'Tell us about the event. You can add items after this.'
    "
    :roles="['customer']"
  >
    <template #actions>
      <template v-if="!loading && !loadError && !closed">
        <Link :href="backUrl" class="button secondary">Cancel</Link>
        <!-- The button is outside the form. `form` connects them. -->
        <button type="submit" :form="FORM_ID" :disabled="busy">
          {{ editing ? "Save changes" : "Create project" }}
        </button>
      </template>
    </template>

    <template #default>
      <PageState :loading="loading" :error="loadError" @retry="load">
      <div v-if="closed" class="state">
        <strong>This project is {{ closed }}.</strong>
        <span>It cannot change any more.</span>
        <Link :href="backUrl" class="button secondary">Back to the project</Link>
      </div>
      <div v-else class="form-split">
        <form :id="FORM_ID" class="card wide" @submit.prevent="save">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <p v-if="locked" class="notice" role="status">
            An order of this project waits for an answer or is accepted. The dates, the place
            and the booth cannot change now. Cancel the waiting orders first, or ask the
            supplier. You can still change the name and the notes.
          </p>
          <label>
            Event name
            <input v-model="form.name" name="name" type="text" maxlength="100" required />
          </label>
          <div class="two">
            <label>
              <span>Place <small class="muted">(optional)</small></span>
              <input
                v-model="form.venue" name="venue"
                type="text"
                maxlength="150"
                placeholder="The venue, like Singapore Expo"
                :disabled="locked"
              />
            </label>
            <label>
              <span>City <small class="muted">(optional)</small></span>
              <input v-model="form.city" name="city" type="text" maxlength="100" :disabled="locked" />
            </label>
          </div>
          <div class="two">
            <label>
              Start date
              <input
                v-model="form.startsOn" name="startsOn"
                type="date"
                :min="editing ? undefined : today"
                :disabled="locked"
                aria-describedby="starts-hint"
                required
              />
              <small v-if="!editing" id="starts-hint" class="muted">Today or later.</small>
            </label>
            <label>
              End date
              <input
                v-model="form.endsOn" name="endsOn"
                type="date"
                :min="form.startsOn"
                :disabled="locked"
                aria-describedby="ends-hint"
                required
              />
              <small id="ends-hint" class="muted">The start date or later.</small>
            </label>
          </div>
          <label>
            <span>Setup date <small class="muted">(optional)</small></span>
            <input v-model="form.setupOn" name="setupOn" type="date" :max="form.startsOn" :disabled="locked" />
            <small class="muted">
              The day the build of the booth starts. The start date or earlier.
            </small>
          </label>
          <div class="two">
            <label>
              <span>Hall <small class="muted">(optional)</small></span>
              <input v-model="form.hall" name="hall" type="text" maxlength="50" :disabled="locked" />
            </label>
            <label>
              <span>Booth number <small class="muted">(optional)</small></span>
              <input v-model="form.boothNumber" name="boothNumber" type="text" maxlength="50" :disabled="locked" />
            </label>
          </div>
          <div class="two">
            <label>
              <span>Booth width (m) <small class="muted">(optional)</small></span>
              <input
                v-model="form.boothWidthM" name="boothWidthCm"
                type="number"
                min="0.01"
                max="1000"
                step="0.01"
                :disabled="locked"
              />
            </label>
            <label>
              <span>Booth depth (m) <small class="muted">(optional)</small></span>
              <input
                v-model="form.boothDepthM" name="boothDepthCm"
                type="number"
                min="0.01"
                max="1000"
                step="0.01"
                :disabled="locked"
              />
            </label>
          </div>
          <label>
            <span>Notes <small class="muted">(optional)</small></span>
            <textarea v-model="form.notes" name="notes" rows="3" maxlength="2000"></textarea>
          </label>
          <div class="form-foot">
            <!-- The same message as at the top. A screen reader hears the first one. -->
            <p v-if="error" class="error" aria-hidden="true">{{ error }}</p>
            <Link :href="backUrl" class="button secondary">Cancel</Link>
            <button type="submit" :disabled="busy">
              {{ editing ? "Save changes" : "Create project" }}
            </button>
          </div>
        </form>

        <aside v-if="!editing" class="preview" aria-label="What happens next">
          <h2 class="eyebrow">What happens next</h2>
          <ol class="steps">
            <li>
              <strong>Create the project</strong>
              <small>It is saved as a draft.</small>
            </li>
            <li>
              <strong>Add items</strong>
              <small>Pick from the catalog or use your own items.</small>
            </li>
            <li>
              <strong>Send the request</strong>
              <small>Each supplier accepts or rejects their order.</small>
            </li>
          </ol>
        </aside>
      </div>
      </PageState>
    </template>
  </Layout>
  </template>
</template>
