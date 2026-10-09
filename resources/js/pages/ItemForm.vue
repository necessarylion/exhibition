<script setup lang="ts">
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { ImagePlus, Package, Plus, TriangleAlert, X } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, type Item, type ItemInput, type ItemPhoto, type ItemUnit } from "../api";
import { countText, formatDateRange } from "../dates";
import { flashLater } from "../flash";
import { isMissing, messageOf, showError, useLeaveGuard } from "../form-errors";
import Layout from "../Layout.vue";
import { formatPrice, UNIT_LABELS } from "../money";
import PageState from "../PageState.vue";
import NotFound from "./NotFound.vue";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS = 8;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
// The biggest numbers the API takes (a PostgreSQL INTEGER, the price in cents).
const MAX_PRICE = 21_474_836.47;
const MAX_STOCK = 2_147_483_647;
/** The usual kinds of items. They are offered next to the categories the company already uses. */
const COMMON_CATEGORIES = ["Booth", "Flooring", "Furniture", "Graphics", "Lighting", "Screens"];

/** A chosen file that is not uploaded yet. `url` is a preview that lives in memory. */
interface PendingPhoto {
  file: File;
  url: string;
  state: "waiting" | "uploading" | "failed";
}

/** A number input gives a number, or "" when it is empty. */
type NumberField = number | "";

// The same page creates and edits. `/items/<id>/edit` has an id, `/items/new` has none.
const urlId = usePage().url.split("/")[2] ?? "";
const editing = urlId !== "new";
const FORM_ID = "item-form";
const SUBTITLES = {
  admin: "What customers see of this item in the catalog.",
  supplier: "What customers see of this item in the catalog.",
  customer: "Something you own, like your own counter. It is free in your projects.",
};

// Empty until the item exists. A new item gets its id after the first save.
const itemId = ref(editing ? urlId : "");
const form = ref({
  name: "",
  category: "",
  sku: "",
  price: "" as NumberField,
  unit: "piece" as ItemUnit,
  stock: "" as NumberField,
  widthCm: "" as NumberField,
  heightCm: "" as NumberField,
  depthCm: "" as NumberField,
  weightKg: "" as NumberField,
  color: "",
  material: "",
  description: "",
  listed: true,
});
const categories = ref<string[]>([]);
// The uploaded photos come first. The chosen files wait for the upload.
const savedPhotos = ref<ItemPhoto[]>([]);
const pendingPhotos = ref<PendingPhoto[]>([]);
const loading = ref(true);
const missing = ref(false);
const loadError = ref("");
const error = ref("");
/** What is wrong with the files the user just chose. One line per file. */
const photoError = ref("");
const busy = ref(false);
/** The days where accepted orders hold more than the saved stock. */
const overbooked = ref<Item["overbooked"]>([]);
const overbookedText = computed(describeOverbooked);
/** What the form held when it was loaded or saved last. Only the changes are sent. */
let saved: ItemInput | null = null;
/** The same as text, to see if the user changed something. */
let before = JSON.stringify(toInput());

const title = computed(buildTitle);
const photoCount = computed(countPhotos);
const coverUrl = computed(findCoverUrl);
const size = computed(formatSize);
const stockText = computed(describeStock);

useLeaveGuard(isDirty);

/** After the first save the page is the edit page of the new item. */
function buildTitle(): string {
  return itemId.value ? "Edit item" : "New item";
}

function isDirty(): boolean {
  return JSON.stringify(toInput()) !== before || pendingPhotos.value.length > 0;
}

/** The same words as on the real card: "6 in stock". Empty when there is no limit. */
function describeStock(): string {
  const stock = form.value.stock;
  if (stock === "") {
    return "";
  }
  return stock === 0 ? "Out of stock" : `${stock.toLocaleString("en-US")} in stock`;
}

/** Like "12 – 14 Mar 2027 needs 6". */
function describeOverbooked(): string {
  const parts: string[] = [];
  for (const range of overbooked.value) {
    parts.push(`${formatDateRange(range.from, range.to)} needs ${range.booked}`);
  }
  return parts.join(", ");
}

function countPhotos(): number {
  return savedPhotos.value.length + pendingPhotos.value.length;
}

function findCoverUrl(): string {
  return savedPhotos.value[0]?.url ?? pendingPhotos.value[0]?.url ?? "";
}

/** Like "300 × 250 × 300 cm". Empty when no size is set. */
function formatSize(): string {
  const parts: number[] = [];
  for (const value of [form.value.widthCm, form.value.heightCm, form.value.depthCm]) {
    if (value !== "") {
      parts.push(value);
    }
  }
  return parts.length > 0 ? `${parts.join(" × ")} cm` : "";
}

function fill(item: Item) {
  form.value = {
    name: item.name,
    category: item.category,
    sku: item.sku ?? "",
    price: item.priceCents / 100,
    unit: item.unit,
    stock: item.stock ?? "",
    widthCm: item.widthCm ?? "",
    heightCm: item.heightCm ?? "",
    depthCm: item.depthCm ?? "",
    weightKg: item.weightKg ?? "",
    color: item.color ?? "",
    material: item.material ?? "",
    description: item.description,
    listed: !item.hiddenAt,
  };
  savedPhotos.value = item.photos;
  overbooked.value = item.overbooked;
  remember(toInput());
}

function remember(input: ItemInput) {
  saved = input;
  before = JSON.stringify(input);
}

async function load() {
  loadError.value = "";
  try {
    if (editing) {
      const [item, me] = await Promise.all([api.getItem(urlId), api.me()]);
      // An admin can read every item, but only the owner company can change it.
      if (item.companyId !== me.companyId) {
        missing.value = true;
      } else {
        fill(item);
      }
    }
  } catch (caught) {
    // An item that does not exist, or that the user cannot see, is the "not found" page.
    missing.value = isMissing(caught);
    loadError.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
  loadCategories();
}

/** The category names for the suggestions. The form works without them. */
async function loadCategories() {
  try {
    const names = new Set<string>([...COMMON_CATEGORIES, ...(await api.listCategories("mine"))]);
    categories.value = [...names].sort();
  } catch {
    // No suggestions this time.
  }
}

function priceCents(): number {
  return Math.round(Number(form.value.price) * 100);
}

function numberOrNull(value: NumberField): number | null {
  return value === "" ? null : value;
}

/** Why this file cannot be a photo. "" when it can. It is checked when it is chosen. */
async function refuse(file: File): Promise<string> {
  if (!PHOTO_TYPES.includes(file.type)) {
    return `"${file.name}" is not a JPG, PNG or WebP file.`;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `"${file.name}" is too big. A photo can be up to 5 MB.`;
  }
  try {
    // A text file with the name of a picture fails here.
    (await createImageBitmap(file)).close();
    return "";
  } catch {
    return `"${file.name}" is not a real picture.`;
  }
}

async function choosePhotos(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  // Clear the input, so the same file can be chosen again.
  input.value = "";
  const problems: string[] = [];
  let leftOut = 0;
  for (const file of files) {
    if (photoCount.value >= MAX_PHOTOS) {
      leftOut += 1;
      continue;
    }
    const problem = await refuse(file);
    if (problem) {
      problems.push(problem);
    } else {
      pendingPhotos.value.push({ file, url: URL.createObjectURL(file), state: "waiting" });
    }
  }
  if (leftOut > 0) {
    const verb = leftOut === 1 ? "was" : "were";
    problems.push(
      `An item can have up to ${MAX_PHOTOS} photos. ${countText(leftOut, "photo")} ${verb} left out.`,
    );
  }
  photoError.value = problems.join("\n");
  // An item that exists gets its photos at once. A new item gets them on save.
  if (itemId.value) {
    await run(uploadAndTell);
  }
}

/**
 * Uploads the waiting files one by one, in order. A file that fails stays on the page
 * as "Failed", and the next ones still go up. Answers how many failed.
 */
async function uploadPending(): Promise<number> {
  for (const photo of [...pendingPhotos.value]) {
    if (photo.state !== "waiting") {
      continue;
    }
    photo.state = "uploading";
    try {
      const item = await api.addItemPhoto(itemId.value, photo.file);
      savedPhotos.value = item.photos;
      dropPending(photo);
    } catch {
      photo.state = "failed";
    }
  }
  return countFailed();
}

function countFailed(): number {
  let failed = 0;
  for (const photo of pendingPhotos.value) {
    if (photo.state === "failed") {
      failed += 1;
    }
  }
  return failed;
}

function retry(photo: PendingPhoto) {
  photo.state = "waiting";
  return run(uploadAndTell);
}

async function uploadAndTell() {
  const failed = await uploadPending();
  error.value = failed > 0 ? failedText(failed) : "";
}

function failedText(failed: number): string {
  const which = failed === 1 ? "it" : "them";
  return `The item is saved, but ${countText(failed, "photo")} could not be uploaded. Try again or remove ${which}.`;
}

/** A preview URL keeps the file in memory until it is released. */
function dropPending(photo: PendingPhoto) {
  URL.revokeObjectURL(photo.url);
  pendingPhotos.value.splice(pendingPhotos.value.indexOf(photo), 1);
  if (countFailed() === 0 && error.value.startsWith("The item is saved")) {
    error.value = "";
  }
}

function releasePreviews() {
  for (const photo of pendingPhotos.value) {
    URL.revokeObjectURL(photo.url);
  }
}

function coverPending(photo: PendingPhoto) {
  pendingPhotos.value.splice(pendingPhotos.value.indexOf(photo), 1);
  pendingPhotos.value.unshift(photo);
}

function coverSaved(photo: ItemPhoto) {
  return run(async function cover() {
    savedPhotos.value = (await api.setItemCover(itemId.value, photo.id)).photos;
  });
}

function removeSaved(photo: ItemPhoto) {
  return run(async function remove() {
    savedPhotos.value = (await api.removeItemPhoto(itemId.value, photo.id)).photos;
  });
}

function toInput(): ItemInput {
  return {
    name: form.value.name,
    category: form.value.category,
    description: form.value.description,
    priceCents: priceCents(),
    sku: form.value.sku.trim() || null,
    unit: form.value.unit,
    widthCm: numberOrNull(form.value.widthCm),
    heightCm: numberOrNull(form.value.heightCm),
    depthCm: numberOrNull(form.value.depthCm),
    weightKg: numberOrNull(form.value.weightKg),
    color: form.value.color.trim() || null,
    material: form.value.material.trim() || null,
    stock: numberOrNull(form.value.stock),
    hidden: !form.value.listed,
  };
}

/**
 * Only the fields the user changed. A field that was not touched is never sent, so a
 * save cannot write an old value (like the stock) over a newer one.
 */
function changesOf(input: ItemInput, old: ItemInput): Partial<ItemInput> {
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    if (value !== old[field as keyof ItemInput]) {
      changes[field] = value;
    }
  }
  return changes;
}

async function saveItem() {
  const input = toInput();
  if (!itemId.value) {
    itemId.value = (await api.createItem(input)).id;
    // The item exists now, so this page is its edit page. A reload opens it again.
    window.history.replaceState(window.history.state, "", `/items/${itemId.value}/edit`);
  } else {
    const changes = saved ? changesOf(input, saved) : input;
    if (Object.keys(changes).length > 0) {
      overbooked.value = (await api.updateItem(itemId.value, changes)).overbooked;
    }
  }
  remember(input);
  // "Save" also tries the photos that failed before.
  for (const photo of pendingPhotos.value) {
    photo.state = "waiting";
  }
  const failed = await uploadPending();
  if (failed > 0) {
    // The item is saved. The user stays here to try the photos again or to remove them.
    error.value = failedText(failed);
    return;
  }
  // The stock can go below what is booked. The save works, and the owner is told.
  const warning = overbookedText.value
    ? ` You now have less than what is booked: ${overbookedText.value}.`
    : "";
  flashLater(`"${input.name}" is saved.${warning}`);
  router.visit("/items");
}

function save() {
  return run(saveItem);
}

/** Runs one action at a time and shows its error. */
async function run(action: () => Promise<unknown>) {
  error.value = "";
  busy.value = true;
  try {
    await action();
  } catch (caught) {
    error.value = showError(caught);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
onBeforeUnmount(releasePreviews);
</script>

<template>
  <NotFound v-if="missing" />
  <template v-else>
    <Head :title="`${form.name || title} · My items`" />
    <Layout :title="title" :subtitle="SUBTITLES">
      <template #actions>
        <Link href="/items" class="button secondary">Cancel</Link>
        <!-- The button is outside the form. `form` connects them. -->
        <button v-if="!loading && !loadError" type="submit" :form="FORM_ID" :disabled="busy">
          Save item
        </button>
      </template>

      <template #default="{ user }">
        <PageState :loading="loading" :error="loadError" @retry="load">
          <div class="form-split">
            <form :id="FORM_ID" class="card wide" style="max-width: 768px" @submit.prevent="save">
              <p v-if="error" class="error" role="alert">{{ error }}</p>
              <label>
                Item name
                <input v-model="form.name" name="name" type="text" maxlength="100" required />
              </label>
              <div class="two">
                <label>
                  Category
                  <input
                    v-model="form.category"
                    name="category"
                    type="text"
                    maxlength="50"
                    list="categories"
                    placeholder="Choose one or type your own"
                    required
                  />
                  <datalist id="categories">
                    <option v-for="name in categories" :key="name" :value="name" />
                  </datalist>
                </label>
                <label>
                  <span>SKU <small class="muted">(optional)</small></span>
                  <input v-model="form.sku" name="sku" type="text" maxlength="50" />
                </label>
              </div>
              <div class="fields" style="align-items: start">
                <label>
                  Unit
                  <select v-model="form.unit" name="unit">
                    <option v-for="(label, unit) in UNIT_LABELS" :key="unit" :value="unit">
                      {{ label }}
                    </option>
                  </select>
                </label>
                <label>
                  <span v-if="user.role === 'customer'">
                    Value (USD) <small class="muted">(optional)</small>
                  </span>
                  <template v-else>Price (USD)</template>
                  <input
                    v-model="form.price"
                    name="priceCents"
                    type="number"
                    min="0"
                    :max="MAX_PRICE"
                    step="0.01"
                    :required="user.role !== 'customer'"
                  />
                  <small v-if="user.role === 'customer'" class="muted">
                    Only for your own notes. Your own items are free in your projects.
                  </small>
                  <small v-else class="muted">
                    For one {{ UNIT_LABELS[form.unit] }}, for the whole event.
                  </small>
                </label>
                <label>
                  <span>How many you have <small class="muted">(optional)</small></span>
                  <input
                    v-model="form.stock"
                    name="stock"
                    type="number"
                    min="0"
                    :max="MAX_STOCK"
                    step="1"
                    :class="{ warned: overbookedText }"
                    :aria-describedby="overbookedText ? 'stock-warning' : undefined"
                  />
                  <small v-if="overbookedText" id="stock-warning" class="stock-warning">
                    <TriangleAlert :size="14" aria-hidden="true" />
                    This is less than what is booked: {{ overbookedText }}. The orders stay as
                    they are.
                  </small>
                  <small class="muted">
                    Empty means no limit. We count what is booked for the same dates.
                  </small>
                </label>
              </div>
              <div class="fields">
                <label>
                  <span>Width (cm) <small class="muted">(optional)</small></span>
                  <input
                    v-model="form.widthCm"
                    name="widthCm"
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                  />
                </label>
                <label>
                  <span>Height (cm) <small class="muted">(optional)</small></span>
                  <input
                    v-model="form.heightCm"
                    name="heightCm"
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                  />
                </label>
                <label>
                  <span>Depth (cm) <small class="muted">(optional)</small></span>
                  <input
                    v-model="form.depthCm"
                    name="depthCm"
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                  />
                </label>
                <label>
                  <span>Weight (kg) <small class="muted">(optional)</small></span>
                  <input
                    v-model="form.weightKg"
                    name="weightKg"
                    type="number"
                    min="0.001"
                    max="100000"
                    step="0.001"
                  />
                </label>
              </div>
              <div class="two">
                <label>
                  <span>Color <small class="muted">(optional)</small></span>
                  <input v-model="form.color" name="color" type="text" maxlength="50" />
                </label>
                <label>
                  <span>Material <small class="muted">(optional)</small></span>
                  <input v-model="form.material" name="material" type="text" maxlength="50" />
                </label>
              </div>
              <label>
                <span>Description <small class="muted">(optional)</small></span>
                <textarea
                  v-model="form.description"
                  name="description"
                  rows="3"
                  maxlength="1000"
                ></textarea>
              </label>

              <section class="stack" style="gap: 0.5rem" aria-labelledby="photos-label">
                <div class="label-row" style="flex-wrap: wrap">
                  <strong id="photos-label" style="font-size: 13px; font-weight: 600">Photos</strong>
                  <small class="muted">
                    {{ photoCount }} of {{ MAX_PHOTOS }} photos · JPG, PNG or WebP, up to 5 MB each
                  </small>
                </div>
                <ul class="photo-grid">
                  <li v-for="(photo, index) in savedPhotos" :key="photo.id" class="photo-tile">
                    <img :src="photo.url" :alt="`Photo ${index + 1}`" />
                    <span v-if="index === 0" class="badge">Cover</span>
                    <button
                      type="button"
                      class="remove"
                      :disabled="busy"
                      :aria-label="`Remove photo ${index + 1}`"
                      title="Remove"
                      @click="removeSaved(photo)"
                    >
                      <X :size="14" aria-hidden="true" />
                    </button>
                    <footer>
                      <template v-if="index === 0">Cover photo</template>
                      <button
                        v-else
                        type="button"
                        :disabled="busy"
                        :aria-label="`Make photo ${index + 1} the cover`"
                        @click="coverSaved(photo)"
                      >
                        Make cover
                      </button>
                    </footer>
                  </li>
                  <li
                    v-for="(photo, index) in pendingPhotos"
                    :key="photo.url"
                    class="photo-tile"
                    :class="{ failed: photo.state === 'failed' }"
                  >
                    <img :src="photo.url" :alt="`New photo ${index + 1}: ${photo.file.name}`" />
                    <span v-if="index === 0 && savedPhotos.length === 0" class="badge">Cover</span>
                    <button
                      type="button"
                      class="remove"
                      :disabled="photo.state === 'uploading'"
                      :aria-label="`Remove new photo ${index + 1}`"
                      title="Remove"
                      @click="dropPending(photo)"
                    >
                      <X :size="14" aria-hidden="true" />
                    </button>
                    <footer>
                      <template v-if="photo.state === 'failed'">
                        Failed — try again
                        <span class="inline">
                          <button
                            type="button"
                            :disabled="busy"
                            :aria-label="`Try new photo ${index + 1} again`"
                            @click="retry(photo)"
                          >
                            Try again
                          </button>
                          <button
                            type="button"
                            :aria-label="`Remove failed photo ${index + 1}`"
                            @click="dropPending(photo)"
                          >
                            Remove
                          </button>
                        </span>
                      </template>
                      <template v-else-if="photo.state === 'uploading'">Uploading…</template>
                      <template v-else-if="index === 0 && savedPhotos.length === 0">
                        Cover photo
                      </template>
                      <!-- A waiting photo can move only before the item exists. After that
                           the uploaded photos come first. -->
                      <button
                        v-else-if="!itemId"
                        type="button"
                        :aria-label="`Make new photo ${index + 1} the cover`"
                        @click="coverPending(photo)"
                      >
                        Make cover
                      </button>
                      <template v-else>Waiting</template>
                    </footer>
                  </li>
                  <li v-if="photoCount < MAX_PHOTOS">
                    <label class="dropzone">
                      <ImagePlus :size="24" aria-hidden="true" />
                      <strong>Add photo</strong>
                      <!-- The input covers the whole tile, so a click and a drop both work. -->
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        :disabled="busy"
                        @change="choosePhotos"
                      />
                    </label>
                  </li>
                </ul>
                <p v-if="photoError" class="error" role="alert">{{ photoError }}</p>
              </section>

              <label class="check">
                <input
                  v-model="form.listed"
                  name="hidden"
                  type="checkbox"
                  class="switch"
                  role="switch"
                />
                <span>
                  <strong>Listed in the catalog</strong>
                  <small v-if="user.role === 'customer'" class="muted">
                    Turn off to hide this item from your catalog and from your group.
                  </small>
                  <small v-else class="muted">Turn off to hide this item from customers.</small>
                </span>
              </label>
              <div class="form-foot">
                <!-- The same message as at the top. A screen reader hears the first one. -->
                <p v-if="error" class="error" aria-hidden="true">{{ error }}</p>
                <Link href="/items" class="button secondary">Cancel</Link>
                <button type="submit" :disabled="busy">Save item</button>
              </div>
            </form>

            <aside class="preview" aria-label="Preview">
              <p class="eyebrow">
                {{ user.role === "customer" ? "How it looks in the catalog" : "How customers see it" }}
              </p>
              <div class="item-card">
                <img v-if="coverUrl" :src="coverUrl" alt="" />
                <div v-else class="no-photo"><Package :size="44" aria-hidden="true" /></div>
                <div class="item-card-body" style="justify-items: stretch">
                  <span>
                    <span class="badge">{{ form.category || "Category" }}</span>
                  </span>
                  <strong>{{ form.name || "Item name" }}</strong>
                  <span class="muted">{{ user.companyName }}</span>
                  <small v-if="stockText || size" class="muted">
                    {{ [stockText, size].filter(Boolean).join(" · ") }}
                  </small>
                  <div class="card-footer">
                    <span v-if="user.role === 'customer'" class="price free">Free</span>
                    <span v-else class="price">
                      {{ formatPrice(priceCents() || 0) }}
                      <small class="muted">/ {{ UNIT_LABELS[form.unit] }}</small>
                    </span>
                    <!-- Only a picture of the button. It does nothing here. -->
                    <span class="fake-button" aria-hidden="true"><Plus :size="16" /> Add</span>
                  </div>
                </div>
              </div>
              <p v-if="!form.listed" class="muted">
                Hidden: nobody sees this item in the catalog now.
              </p>
            </aside>
          </div>
        </PageState>
      </template>
    </Layout>
  </template>
</template>
