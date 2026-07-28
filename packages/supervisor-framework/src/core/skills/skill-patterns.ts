export const buildSkillModuleOwnerPattern = (modules: readonly string[]): RegExp => {
  const owners = modules.map((owner) => owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (owners.length === 0) {
    return /(?!)/;
  }

  return new RegExp(`\\b(${owners.join("|")})\\b`);
};
