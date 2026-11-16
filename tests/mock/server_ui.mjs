/**
 * Recording stand-in for `@minecraft/server-ui`.
 *
 * Forms cannot be "shown" to a bot, so each one records the buttons and fields
 * it was built with and answers with whatever the test has queued. That is
 * enough to assert that the settings menu offers every key, that a toggle
 * mutates the right setting, and that a cancelled form changes nothing.
 */

/** Queued responses; the test pushes what the next form should return. */
export const responses = [];

export const shown = [];

export function queueResponse(response) {
  responses.push(response);
}

export function reset() {
  responses.length = 0;
  shown.length = 0;
}

class BaseForm {
  constructor() {
    this.kind = "form";
    this.buttons = [];
    this.fields = [];
    this.meta = {};
  }

  title(text) {
    this.meta.title = text;
    return this;
  }

  body(text) {
    this.meta.body = text;
    return this;
  }

  header(text) {
    this.meta.header = text;
    return this;
  }

  label(text) {
    this.meta.label = text;
    return this;
  }

  divider() {
    this.buttons.push({ divider: true });
    return this;
  }

  submitButton(text) {
    this.meta.submit = text;
    return this;
  }

  async show(_player) {
    shown.push(this);
    const response = responses.shift();
    if (response === undefined) {
      // No queued answer behaves like the player closing the form.
      return { canceled: true, cancelationReason: "UserClosed" };
    }
    return { canceled: false, ...response };
  }
}

export class ActionFormData extends BaseForm {
  button(text, icon) {
    this.buttons.push({ text, icon });
    return this;
  }
}

export class ModalFormData extends BaseForm {
  slider(label, min, max, options) {
    this.fields.push({ kind: "slider", label, min, max, options });
    return this;
  }

  textField(label, placeholder, options) {
    this.fields.push({ kind: "textField", label, placeholder, options });
    return this;
  }

  toggle(label, options) {
    this.fields.push({ kind: "toggle", label, options });
    return this;
  }

  dropdown(label, options, settings) {
    this.fields.push({ kind: "dropdown", label, options, settings });
    return this;
  }
}
