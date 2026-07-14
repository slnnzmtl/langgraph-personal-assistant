import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  parseFrontmatter,
  listSkills,
  readSkillContent,
  formatSkillsForPrompt,
} from "../../src/prompts/skills-loader";

describe("skills-loader", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(process.cwd(), "test-skills-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("parseFrontmatter", () => {
    it("should parse valid frontmatter block", () => {
      const raw = `---
name: my-skill
description: A test skill
---

# Heading

Some body content.`;
      const result = parseFrontmatter(raw);
      expect(result.data).toEqual({
        name: "my-skill",
        description: "A test skill",
      });
      expect(result.body).toContain("# Heading");
      expect(result.body).toContain("Some body content");
    });

    it("should return empty data if no frontmatter", () => {
      const raw = "# No frontmatter\n\nJust content";
      const result = parseFrontmatter(raw);
      expect(result.data).toEqual({});
      expect(result.body).toBe(raw);
    });

    it("should return empty data if frontmatter block is unclosed", () => {
      const raw = `---
name: incomplete
# No closing marker, just content`;
      const result = parseFrontmatter(raw);
      expect(result.data).toEqual({});
    });

    it("should trim whitespace from values", () => {
      const raw = `---
name:   my-skill  
description:   Trimmed description   
---

Body`;
      const result = parseFrontmatter(raw);
      expect(result.data.name).toBe("my-skill");
      expect(result.data.description).toBe("Trimmed description");
    });
  });

  describe("listSkills", () => {
    it("should return empty array for non-existent directory", () => {
      const result = listSkills(path.join(tempDir, "nonexistent"));
      expect(result).toEqual([]);
    });

    it("should list skills with valid frontmatter", () => {
      const skillsDir = path.join(tempDir, "skills");
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(
        path.join(skillsDir, "skill1.md"),
        `---
name: skill-one
description: First skill
---

Content here`
      );

      writeFileSync(
        path.join(skillsDir, "skill2.md"),
        `---
name: skill-two
description: Second skill
---

More content`
      );

      const result = listSkills(skillsDir);
      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("skill-one");
      expect(result[1]?.name).toBe("skill-two");
    });

    it("should skip files without name or description", () => {
      const skillsDir = path.join(tempDir, "skills-incomplete");
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(
        path.join(skillsDir, "bad1.md"),
        `---
name: only-name
---

No description`
      );

      writeFileSync(
        path.join(skillsDir, "good.md"),
        `---
name: good-skill
description: Good skill
---

Content`
      );

      const result = listSkills(skillsDir);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("good-skill");
    });

    it("should sort skills by name", () => {
      const skillsDir = path.join(tempDir, "skills-sorted");
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(
        path.join(skillsDir, "z-skill.md"),
        `---
name: zebra
description: Z skill
---

Z`
      );

      writeFileSync(
        path.join(skillsDir, "a-skill.md"),
        `---
name: aardvark
description: A skill
---

A`
      );

      const result = listSkills(skillsDir);
      expect(result[0]?.name).toBe("aardvark");
      expect(result[1]?.name).toBe("zebra");
    });
  });

  describe("readSkillContent", () => {
    it("should read skill content by frontmatter name", () => {
      const skillsDir = path.join(tempDir, "read-test");
      mkdirSync(skillsDir, { recursive: true });

      const skillBody = "## Steps\n1. Do this\n2. Do that";
      writeFileSync(
        path.join(skillsDir, "test-skill.md"),
        `---
name: my-skill
description: Test skill
---

${skillBody}`
      );

      const content = readSkillContent(skillsDir, "my-skill");
      expect(content).toBe(skillBody);
    });

    it("should read skill content case-insensitively", () => {
      const skillsDir = path.join(tempDir, "case-test");
      mkdirSync(skillsDir, { recursive: true });

      const skillBody = "Case insensitive test";
      writeFileSync(
        path.join(skillsDir, "test.md"),
        `---
name: TestSkill
description: Test
---

${skillBody}`
      );

      const content = readSkillContent(skillsDir, "testskill");
      expect(content).toBe(skillBody);
    });

    it("should throw error for non-existent skill", () => {
      const skillsDir = path.join(tempDir, "missing-test");
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(
        path.join(skillsDir, "exists.md"),
        `---
name: exists
description: Exists
---

Content`
      );

      expect(() => readSkillContent(skillsDir, "notfound")).toThrow(
        /Skill not found/
      );
    });

    it("should reject path traversal attempts", () => {
      const skillsDir = path.join(tempDir, "traverse-test");
      mkdirSync(skillsDir, { recursive: true });

      // Create a skill with a name that looks like a traversal
      writeFileSync(
        path.join(skillsDir, "safe.md"),
        `---
name: safe
description: Safe skill
---

Content`
      );

      expect(() => readSkillContent(skillsDir, "../secret")).toThrow(
        /not found|Path traversal/i
      );
    });
  });

  describe("formatSkillsForPrompt", () => {
    it("should format skills as prompt block", () => {
      const skills = [
        {
          name: "sync-expenses",
          description: "Sync Wise transactions",
          fileName: "sync-expenses.md",
        },
        {
          name: "categorize",
          description: "Categorize expenses",
          fileName: "categorize.md",
        },
      ];

      const result = formatSkillsForPrompt(skills);
      expect(result).toContain("<available_skills>");
      expect(result).toContain("- sync-expenses: Sync Wise transactions");
      expect(result).toContain("- categorize: Categorize expenses");
      expect(result).toContain("</available_skills>");
    });

    it("should return empty string for empty skill list", () => {
      const result = formatSkillsForPrompt([]);
      expect(result).toBe("");
    });
  });
});
