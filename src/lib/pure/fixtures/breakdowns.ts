/**
 * Breakdowns as production pastes or exports them: from Excel, Google Sheets and Numbers, with the
 * mess real files carry. Each string is byte for byte what the clipboard or the file holds.
 */

/** Excel on Windows, copied cells: tab separated, CRLF, a cell with a line break quoted, a last CRLF. */
export const EXCEL_PASTE =
	'Shot\tDescription\tFrames\tDifficulty\tSequence\r\n' +
	'SH010\tCar crash, wide\t1,234\tComplex\tSQ010\r\n' +
	'SH020\t"Two lines\r\nof action"\t96\tSimple\tSQ010\r\n' +
	'SH030\tSky replacement\t 48 \tModerate\tSQ020\r\n';

/** Google Sheets CSV export, with a BOM, quoted commas, doubled quotes, a blank code, a bad count, trailing blank lines. */
export const SHEETS_CSV =
	'﻿code,description,sequence,frames\r\n' +
	'sh010,"Explosion, big",SQ010,"1,200"\r\n' +
	'sh020,"He said ""go""",SQ010,96\r\n' +
	',A row with no code,SQ020,10\r\n' +
	'sh030,Bad count,SQ020,12a\r\n' +
	'sh040,Half a frame,SQ020,12.5\r\n' +
	'\r\n' +
	'\r\n';

/** No header row, two columns, LF only, no last line break. */
export const NO_HEADER = 'SH100\tFirst shot\nSH110\tSecond shot';

/** A European Excel CSV: semicolons, a dot between thousands, an unknown header. */
export const SEMICOLON_CSV = 'Shot;Beschreibung;Frames\nSH010;Text;1.234\nSH020;Mehr;24,00\n';

/** A breakdown naming the assets each shot uses, and a timecode where a count goes. */
export const WITH_ASSETS =
	'VFX ID,Action,Linked Assets,Duration,Episode,Scene,Type,Notes\n' +
	'ep01_sh010,Dragon lands,"Dragon, Castle",120,EP01,12,CG creature,Hero shot\n' +
	'ep01_sh020,Wide of the castle,castle | Banner,00:00:04:12,EP01,12A,Environment,\n';

/** The same code twice in one paste, and a code the request already has. */
export const REPEATS = 'code,description\nSH010,First take\nSH500,New one\nsh500,Again\n';

/** An asset list: name, type, difficulty. */
export const ASSET_LIST = 'Asset Name,Asset Type,Complexity,Description\nDragon,Character,Hero,The big one\nBanner,Prop,Simple,\n';
