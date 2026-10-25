import path from 'node:path';

// Resolve relative imports so ../ paths cannot bypass feature entry points.
export const sliceBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      boundary:
        'Respect slice boundaries: use feature index.ts entry points; features cannot depend on app, and shared cannot depend on features or app.',
    },
  },
  create(context) {
    const root = path.resolve(import.meta.dirname, '../src');
    const importer = path.relative(root, context.filename).split(path.sep);
    function check(node) {
      const source = node.source;
      if (
        !source ||
        typeof source.value !== 'string' ||
        !source.value.startsWith('.')
      )
        return;
      const target = path
        .relative(
          root,
          path.resolve(path.dirname(context.filename), source.value),
        )
        .split(path.sep);
      const feature = importer[0] === 'features';
      const shared = importer[0] === 'shared';
      const crossFeature =
        target[0] === 'features' && !(feature && importer[1] === target[1]);
      const privateImport =
        crossFeature &&
        target.length > 2 &&
        !(target.length === 3 && /^index(?:\.[jt]sx?)?$/.test(target[2]));
      if (
        (feature && target[0] === 'app') ||
        (shared && ['app', 'features'].includes(target[0])) ||
        privateImport
      ) {
        context.report({ node: source, messageId: 'boundary' });
      }
    }
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};
