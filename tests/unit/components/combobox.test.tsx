// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox, type ComboboxOption } from "@/components/shared/combobox";

const options: ComboboxOption[] = [
  { value: "acme", label: "Acme Co" },
  { value: "globex", label: "Globex" },
];

describe("Combobox", () => {
  it("uses the placeholder as its accessible name when nothing is selected", () => {
    render(<Combobox options={options} onChange={vi.fn()} placeholder="Select a customer…" />);
    // role="combobox" isn't in ARIA's name-from-content list — the fix was
    // an explicit aria-label, not just visible text (see combobox.tsx).
    expect(screen.getByRole("combobox", { name: "Select a customer…" })).toBeInTheDocument();
  });

  it("uses the selected option's label as its accessible name once a value is chosen", () => {
    render(<Combobox options={options} value="acme" onChange={vi.fn()} placeholder="Select a customer…" />);
    expect(screen.getByRole("combobox", { name: "Acme Co" })).toBeInTheDocument();
  });

  it("calls onChange with the picked option's value when an item is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox options={options} onChange={onChange} placeholder="Select a customer…" />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Globex"));
    expect(onChange).toHaveBeenCalledWith("globex");
  });

  it("toggles a selected option off (back to empty) when clicked again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox options={options} value="acme" onChange={onChange} placeholder="Select a customer…" />);
    await user.click(screen.getByRole("combobox"));
    // The trigger already shows "Acme Co" (it's selected) *and* the open
    // list repeats it as an option — scope to the option role so the two
    // aren't ambiguous.
    await user.click(await screen.findByRole("option", { name: "Acme Co" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
