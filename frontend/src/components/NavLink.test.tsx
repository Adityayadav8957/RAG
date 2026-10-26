import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLink, NavLink } from "./NavLink";

describe("NavLink", () => {
  it("renders a real anchor with aria-current on the active route", () => {
    const html = renderToStaticMarkup(
      <NavLink href="/admin" label="Admin" active expanded icon={<i />} />,
    );
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/admin"');
    expect(html).toContain('aria-current="page"');
  });
  it("omits aria-current when inactive and still links", () => {
    const html = renderToStaticMarkup(<NavLink href="/documents" label="Knowledge base" active={false} expanded={false} icon={<i />} />);
    expect(html).toContain('href="/documents"');
    expect(html).not.toContain("aria-current");
  });
  it("brand mark links home", () => {
    const html = renderToStaticMarkup(<BrandLink>E</BrandLink>);
    expect(html).toContain('href="/"');
  });
});
