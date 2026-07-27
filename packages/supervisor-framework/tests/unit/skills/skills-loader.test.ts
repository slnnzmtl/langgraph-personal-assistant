import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  parseFrontmatter,
  parseXmlSkill,
  parseSkillFile,
  parseSkillAttachmentsFromXmlBody,
  loadSkillAttachmentRules,
  stripSkillAttachmentsBlock,
  parseCommaSeparatedPhrases,
  listSkills,
  readSkillContent,
  formatSkillsForPrompt,
  formatSkillsForDisplay,
  createSkillFile,
  updateSkillFile,
  deleteSkillFile,
  readFullSkill,
  formatXmlSkillFile,
  serializeSkillFile,
} from "../../../src/core/skills/skills-loader.js";
import { APP_SKILLS_DIR } from "../../helpers/app-skills-dir.js";

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

  describe("parseXmlSkill", () => {
    it("should parse valid skill XML", () => {
      const raw = `<skill name="cron" description="Manage cron jobs">

<cron_intent_routing>
Call list_cron_jobs().
</cron_intent_routing>

</skill>`;
      const result = parseXmlSkill(raw);
      expect(result.data).toEqual({
        name: "cron",
        description: "Manage cron jobs",
      });
      expect(result.body).toContain("<cron_intent_routing>");
      expect(result.body).not.toContain("</skill>");
    });

    it("strips skill_attachments metadata from the returned body", () => {
      const raw = `<skill name="routine" description="Routine notes">
<skill_attachments>
  <attachment cronJobName="routine-note-creation">
    <anyPhrases>routine,daily</anyPhrases>
  </attachment>
</skill_attachments>

<path_rules>Notes live under routine/</path_rules>
</skill>`;
      const result = parseXmlSkill(raw);

      expect(result.body).toContain("<path_rules>");
      expect(result.body).not.toContain("<skill_attachments>");
      expect(result.body).not.toContain("routine-note-creation");
    });

    it("should return empty data if no skill root element", () => {
      const raw = "<other>content</other>";
      const result = parseXmlSkill(raw);
      expect(result.data).toEqual({});
      expect(result.body).toBe(raw);
    });
  });

  describe("parseSkillFile", () => {
    it("should dispatch to XML parser for .xml files", () => {
      const raw = `<skill name="cron" description="Manage cron jobs">

Body

</skill>`;
      const result = parseSkillFile(raw, "cron.xml");
      expect(result.data.name).toBe("cron");
      expect(result.body).toBe("Body");
    });
  });

  describe("listSkills", () => {
    it("should return empty array for non-existent directory", () => {
      const result = listSkills({ skillsDir: path.join(tempDir, "nonexistent") });
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

      const result = listSkills({ skillsDir });
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

      const result = listSkills({ skillsDir });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("good-skill");
    });

    it("should list skills with valid XML metadata", () => {
      const skillsDir = path.join(tempDir, "skills-xml");
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(
        path.join(skillsDir, "cron.xml"),
        `<skill name="cron" module="configuration" description="Manage cron jobs">

Body

</skill>`,
      );

      const result = listSkills({ skillsDir });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("cron");
      expect(result[0]?.fileName).toBe("cron.xml");
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

      const result = listSkills({ skillsDir });
      expect(result[0]?.name).toBe("aardvark");
      expect(result[1]?.name).toBe("zebra");
    });
  });

  describe("readSkillContent", () => {
    it("reads bundled expense-view skill content from the workspace skills directory", () => {
      const content = readSkillContent("expense-view", { skillsDir: APP_SKILLS_DIR });

      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain("<view_intent>");
    });

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

      const content = readSkillContent("my-skill", { skillsDir });
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

      const content = readSkillContent("testskill", { skillsDir });
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

      expect(() => readSkillContent("notfound", { skillsDir })).toThrow(
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

      expect(() => readSkillContent("../secret", { skillsDir })).toThrow(
        /not found|Path traversal/i
      );
    });
  });

  describe("skill attachment metadata", () => {
    it("parses comma-separated phrases", () => {
      expect(parseCommaSeparatedPhrases("sync expenses, for today ,expense")).toEqual([
        "sync expenses",
        "for today",
        "expense",
      ]);
    });

    it("parses attachment rules from xml body", () => {
      const body = `<skill_attachments>
  <attachment cronJobName="routine-note-creation">
    <anyPhrases>routine,daily</anyPhrases>
  </attachment>
  <attachment>
    <allPhrases>task</allPhrases>
    <anyPhrases>today,yesterday</anyPhrases>
  </attachment>
</skill_attachments>`;

      expect(parseSkillAttachmentsFromXmlBody(body)).toEqual([
        {
          module: "",
          skillName: "",
          cronJobName: "routine-note-creation",
          match: { anyPhrases: ["routine", "daily"] },
        },
        {
          module: "",
          skillName: "",
          match: {
            allPhrases: ["task"],
            anyPhrases: ["today", "yesterday"],
          },
        },
      ]);
    });

    it("loads attachment rules filtered by module", () => {
      const skillsDir = path.join(tempDir, "attachment-rules");
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(
        path.join(skillsDir, "sync-expenses.xml"),
        `<skill name="sync-expenses" module="finance" description="Sync expenses">
<skill_attachments>
  <attachment>
    <anyPhrases>sync expenses,expense</anyPhrases>
  </attachment>
</skill_attachments>

Body
</skill>`,
      );

      expect(loadSkillAttachmentRules("finance", skillsDir)).toEqual([
        {
          module: "finance",
          skillName: "sync-expenses",
          match: { anyPhrases: ["sync expenses", "expense"] },
        },
      ]);
      expect(stripSkillAttachmentsBlock(readSkillContent("sync-expenses", { skillsDir }))).toBe("Body");
    });
  });

  describe("formatSkillsForDisplay", () => {
    it("formats skills using the skill_output_template", () => {
      const skills = [
        {
          name: "sync-expenses",
          description: "Sync Wise transactions",
          module: "finance",
          fileName: "sync-expenses.xml",
        },
      ];

      const result = formatSkillsForDisplay("finance", skills, "Listed");

      expect(result).toContain("Module: finance");
      expect(result).toContain("Skill Name: sync-expenses");
      expect(result).toContain("Description: Sync Wise transactions");
      expect(result).toContain("Status: Listed");
    });

    it("returns an empty-module message when no skills exist", () => {
      expect(formatSkillsForDisplay("configuration", [])).toBe("No skills configured for configuration.");
    });
  });

  describe("formatSkillsForPrompt", () => {
    it("should format skills as prompt block", () => {
      const skills = [
        {
          name: "sync-expenses",
          description: "Sync Wise transactions",
          fileName: "sync-expenses.xml",
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

  describe("skill file serialization", () => {
    it("serializes XML skill files with metadata attributes", () => {
      const serialized = formatXmlSkillFile(
        { name: "cron", description: 'Manage jobs with "quotes"' },
        "<body>content</body>",
      );

      expect(serialized).toContain('<skill name="cron" description="Manage jobs with &quot;quotes&quot;">');
      expect(serialized).toContain("<body>content</body>");
      expect(serialized).toContain("</skill>");
    });

    it("chooses XML serialization based on file extension", () => {
      const serialized = serializeSkillFile(
        { name: "cron", description: "Manage cron jobs" },
        "Body",
        "cron.xml",
      );

      expect(serialized).toContain('<skill name="cron"');
      expect(serialized).toContain("</skill>");
    });
  });

  describe("skill file writes", () => {
    it("creates a skill file with valid xml metadata", () => {
      const skillsDir = path.join(tempDir, "write-create");
      const filePath = createSkillFile(
        "new-skill",
        "A new skill",
        "# Body\nDo the thing",
        "finance",
        skillsDir,
      );

      expect(existsSync(filePath)).toBe(true);
      const raw = readFileSync(filePath, "utf8");
      expect(raw).toContain('name="new-skill"');
      expect(raw).toContain('module="finance"');
      expect(readSkillContent("new-skill", { skillsDir })).toBe("# Body\nDo the thing");
    });

    it("rejects duplicate skill names on create", () => {
      const skillsDir = path.join(tempDir, "write-duplicate");
      createSkillFile("dup-skill", "First", "Body one", "finance", skillsDir);

      expect(() => createSkillFile("dup-skill", "Second", "Body two", "finance", skillsDir)).toThrow(
        /already exists/i,
      );
    });

    it("updates an existing skill with full replacement", () => {
      const skillsDir = path.join(tempDir, "write-update");
      createSkillFile("update-me", "Old description", "Old body", "obsidian", skillsDir);

      const filePath = updateSkillFile(
        "update-me",
        "New description",
        "New body",
        "obsidian",
        skillsDir,
      );

      const skill = readFullSkill("update-me", { skillsDir });
      expect(skill.description).toBe("New description");
      expect(skill.body).toBe("New body");
      expect(readFileSync(filePath, "utf8")).toContain('description="New description"');
    });

    it("deletes an existing skill file", () => {
      const skillsDir = path.join(tempDir, "write-delete");
      createSkillFile("delete-me", "Delete me", "Body", "configuration", skillsDir);

      const fileName = deleteSkillFile("delete-me", skillsDir);

      expect(fileName).toBe("delete-me.xml");
      expect(existsSync(path.join(skillsDir, "delete-me.xml"))).toBe(false);
      expect(() => readSkillContent("delete-me", { skillsDir })).toThrow(/Skill not found/);
    });

    it("throws when deleting a missing skill", () => {
      const skillsDir = path.join(tempDir, "write-delete-missing");
      mkdirSync(skillsDir, { recursive: true });

      expect(() => deleteSkillFile("missing", skillsDir)).toThrow(/Skill not found/);
    });

    it("rejects path traversal attempts on write", () => {
      const skillsDir = path.join(tempDir, "write-traverse");
      mkdirSync(skillsDir, { recursive: true });

      expect(() => createSkillFile("../secret", "Bad", "Body", "finance", skillsDir)).toThrow(
        /Path traversal/i,
      );
    });
  });

  describe("dual-root skill stores", () => {
    it("prefers data skills over shipped skills with the same name", () => {
      const shippedDir = path.join(tempDir, "dual-shipped");
      const dataDir = path.join(tempDir, "dual-data");
      mkdirSync(shippedDir, { recursive: true });
      mkdirSync(dataDir, { recursive: true });

      writeFileSync(
        path.join(shippedDir, "expense-sync.xml"),
        '<skill name="expense-sync" module="finance" description="Shipped">\nShipped body\n</skill>\n',
        "utf8",
      );
      writeFileSync(
        path.join(dataDir, "expense-sync.xml"),
        '<skill name="expense-sync" module="finance" description="Override">\nOverride body\n</skill>\n',
        "utf8",
      );

      const skills = listSkills({ skillsDir: shippedDir, writableSkillsDir: dataDir, module: "finance" });

      expect(skills).toHaveLength(1);
      expect(skills[0]?.description).toBe("Override");
      expect(skills[0]?.source).toBe("data");
      expect(readSkillContent("expense-sync", { skillsDir: shippedDir, writableSkillsDir: dataDir })).toBe(
        "Override body",
      );
    });

    it("writes create and update operations to the writable skills dir", () => {
      const shippedDir = path.join(tempDir, "dual-write-shipped");
      const dataDir = path.join(tempDir, "dual-write-data");
      mkdirSync(shippedDir, { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      const storeOptions = { skillsDir: shippedDir, writableSkillsDir: dataDir };

      const createdPath = createSkillFile(
        "custom-finance",
        "Custom finance skill",
        "Custom body",
        "finance",
        storeOptions,
      );

      expect(createdPath.startsWith(dataDir)).toBe(true);
      expect(existsSync(path.join(dataDir, "custom-finance.xml"))).toBe(true);

      writeFileSync(
        path.join(shippedDir, "expense-view.xml"),
        '<skill name="expense-view" module="finance" description="Shipped view">\nShipped view body\n</skill>\n',
        "utf8",
      );

      updateSkillFile(
        "expense-view",
        "Updated view",
        "Updated body",
        "finance",
        storeOptions,
      );

      expect(readSkillContent("expense-view", storeOptions)).toBe("Updated body");
      expect(existsSync(path.join(dataDir, "expense-view.xml"))).toBe(true);
      expect(readFileSync(path.join(shippedDir, "expense-view.xml"), "utf8")).toContain("Shipped view body");
    });

    it("blocks deleting shipped-only skills and removes data overrides", () => {
      const shippedDir = path.join(tempDir, "dual-delete-shipped");
      const dataDir = path.join(tempDir, "dual-delete-data");
      mkdirSync(shippedDir, { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      const storeOptions = { skillsDir: shippedDir, writableSkillsDir: dataDir };

      writeFileSync(
        path.join(shippedDir, "expense-sync.xml"),
        '<skill name="expense-sync" module="finance" description="Shipped">\nShipped body\n</skill>\n',
        "utf8",
      );

      expect(() => deleteSkillFile("expense-sync", storeOptions)).toThrow(/Cannot delete shipped skill/i);

      createSkillFile("custom-skill", "Custom", "Body", "obsidian", storeOptions);
      expect(deleteSkillFile("custom-skill", storeOptions)).toBe("custom-skill.xml");
      expect(existsSync(path.join(dataDir, "custom-skill.xml"))).toBe(false);

      writeFileSync(
        path.join(dataDir, "expense-sync.xml"),
        '<skill name="expense-sync" module="finance" description="Override">\nOverride body\n</skill>\n',
        "utf8",
      );
      expect(deleteSkillFile("expense-sync", storeOptions)).toBe("expense-sync.xml");
      expect(readSkillContent("expense-sync", storeOptions)).toBe("Shipped body");
    });
  });
});
