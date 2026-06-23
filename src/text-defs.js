export const FONTS = [
    { name: 'Chicago',            css: 'ui-monospace, "Courier New", monospace'                        },
    { name: 'Courier',            css: '"Courier New", Courier, monospace'                             },
    { name: 'Geneva',             css: 'Geneva, Tahoma, "Arial", sans-serif'                           },
    { name: 'Helvetica',          css: '"Helvetica Neue", Helvetica, Arial, sans-serif'                },
    { name: 'London',             css: 'Palatino, "Book Antiqua", Georgia, serif'                      },
    { name: 'Monaco',             css: 'Monaco, "Courier New", monospace'                              },
    { name: 'N Helvetica Narrow', css: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif'           },
    { name: 'New York',           css: '"New York", "Times New Roman", Georgia, serif'                 },
    { name: 'Palatino',           css: 'Palatino, "Book Antiqua", Georgia, serif'                     },
    { name: 'Symbol',             css: 'Symbol, serif'                                                 },
    { name: 'Times',              css: '"Times New Roman", Times, serif'                               },
    { name: 'Venice',             css: '"Brush Script MT", "Comic Sans MS", cursive'                   },
    { name: 'Zapf Chancery',      css: '"Zapf Chancery", "Palatino Linotype", Palatino, cursive'       },
];

export const FONT_SIZES = [9, 10, 12, 14, 18, 24, 36, 48];

// Style bits — can be OR'd together (except 0 = Plain which clears all)
export const STYLE_DEFS = [
    { id: 0,  name: 'Plain Text', kbd: '⌘T' },
    { id: 1,  name: 'Bold',       kbd: '⌘B' },
    { id: 2,  name: 'Italic',     kbd: '⌘I' },
    { id: 4,  name: 'Underline',  kbd: '⌘U' },
    { id: 8,  name: 'Outline',    kbd: null  },
    { id: 16, name: 'Shadow',     kbd: null  },
];

/**
 * Returns the CSS font-family string for a named MacDraw font.
 * Falls back to a generic sans-serif stack when the name is not in the list.
 *
 * @param {string} name - MacDraw font name (e.g. 'Geneva', 'Times').
 * @returns {string} A CSS font-family value ready for use in a style attribute.
 */
export function fontCss(name) {
    return FONTS.find(f => f.name === name)?.css ?? `"${name}", sans-serif`;
}
