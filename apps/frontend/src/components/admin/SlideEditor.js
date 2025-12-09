import React, { useState, useRef, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import { toBlob } from 'html-to-image';
import {
    Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, Slider, Stack, TextField, Typography,
    Paper, Select, MenuItem, ToggleButton, ToggleButtonGroup,
    Tooltip, Popover, List, ListItem, ListItemText, Divider,
    Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';

// Icons
import TextFieldsIcon from '@mui/icons-material/TextFields';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import ImageIcon from '@mui/icons-material/Image';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter';
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import StarIcon from '@mui/icons-material/Star';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import WallpaperIcon from '@mui/icons-material/Wallpaper';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FlipToFrontIcon from '@mui/icons-material/FlipToFront';
import FlipToBackIcon from '@mui/icons-material/FlipToBack';


import SlideElement, { ICONS } from '../ads/SlideElement';
import api from '../../services/api';

const ASSETS_LOGO = '/assets/images/Logo.png';
const FONTS = ['Roboto', 'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia', 'Impact'];
const EMOJIS = ['😊', '🎉', '🍺', '🍹', '🍕', '🔥', '❤️', '✅', '⚠️', '📍', '🕒', '💶'];

export default function SlideEditor({ open, onClose, onSave, initialData }) {
    const [elements, setElements] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [bgColor, setBgColor] = useState('#000000');
    const [bgImage, setBgImage] = useState(null);
    const [scale, setScale] = useState(0.6); // Viewport scale
    const [anchorElEmoji, setAnchorElEmoji] = useState(null);

    // Menu Selection
    const [menuDialogOpen, setMenuDialogOpen] = useState(false);
    const [categories, setCategories] = useState([]);

    const canvasRef = useRef(null);
    const containerRef = useRef(null);

    // Reset on open or load initial data
    useEffect(() => {
        if (open) {
            if (initialData) {
                setElements(initialData.elements || []);
                setBgColor(initialData.bgColor || '#000000');
                setBgImage(initialData.bgImage || null);
            } else {
                // Initialize with Logo default
                const newId = Date.now().toString();
                const defaultLogo = {
                    id: newId,
                    x: 50,
                    y: 600,
                    width: 300,
                    height: 300,
                    content: ASSETS_LOGO,
                    type: 'image',
                    rotation: 0,
                    color: '#ffffff',
                    zIndex: 1
                };
                setElements([defaultLogo]);
                setBgColor('#000000');
                setBgImage(null);
            }
            setSelectedId(null);
        }
    }, [open, initialData]);

    // Fetch Categories for Menu
    useEffect(() => {
        if (open) {
            api.get('/articles?includeInactive=false').then(res => {
                if (res.data && res.data.articles) {
                    const cats = [...new Set(res.data.articles.map(a => a.category).filter(Boolean))];
                    setCategories(cats.sort());
                }
            }).catch(console.error);
        }
    }, [open]);

    const addElement = (type, extraProps = {}) => {
        const newId = Date.now().toString();
        const defaultProps = {
            id: newId,
            x: 100,
            y: 100,
            rotation: 0,
            color: '#ffffff',
            type,
            zIndex: elements.length + 1,
            ...extraProps
        };

        let newEl = { ...defaultProps };

        if (type === 'text') {
            newEl = {
                ...defaultProps,
                width: 400, height: 100,
                content: 'Neuer Text',
                fontSize: 60,
                fontFamily: 'Roboto',
                fontWeight: 'normal',
                fontStyle: 'normal',
                textAlign: 'center'
            };
        } else if (type === 'rect') {
            newEl = { ...defaultProps, width: 200, height: 200, content: '', color: '#2196f3' };
        } else if (type === 'circle') {
            newEl = { ...defaultProps, width: 200, height: 200, content: '', borderRadius: '50%', color: '#f44336' };
        } else if (type === 'line') {
            newEl = { ...defaultProps, width: 300, height: 40, content: '', color: '#ffffff' };
        } else if (type === 'logo') {
            newEl = {
                ...defaultProps,
                width: 300, height: 300,
                content: ASSETS_LOGO,
                type: 'image',
                x: 50,
                y: 600
            };
        } else if (type === 'icon') {
            newEl = { ...defaultProps, width: 150, height: 150, content: extraProps.iconName };
        } else if (type === 'menu') {
            newEl = {
                ...defaultProps,
                width: 600, height: 800,
                content: extraProps.category,
                fontSize: 40,
                color: '#ffffff',
                x: 1200, y: 100
            };
        }

        setElements([...elements, newEl]);
        setSelectedId(newId);
    };

    const updateElement = (id, props) => {
        setElements(elements.map(el => el.id === id ? { ...el, ...props } : el));
    };

    const handleDelete = () => {
        if (selectedId) {
            setElements(elements.filter(el => el.id !== selectedId));
            setSelectedId(null);
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                addElement('image', {
                    content: event.target.result,
                    width: 400,
                    height: 400,
                    type: 'image'
                });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleBgUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setBgImage(event.target.result);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = async () => {
        if (canvasRef.current) {
            setSelectedId(null);
            setTimeout(async () => {
                try {
                    const blob = await toBlob(canvasRef.current, {
                        quality: 0.95,
                        width: 1920,
                        height: 1080,
                        pixelRatio: 1,
                        style: {
                            transform: 'scale(1)',
                            transformOrigin: 'top left',
                        }
                    });

                    if (blob) {
                        const file = new File([blob], `slide-${Date.now()}.png`, { type: 'image/png' });
                        // Save bgImage and elements
                        const slideData = JSON.stringify({ elements, bgColor, bgImage });
                        onSave(file, slideData);
                    }
                } catch (err) {
                    console.error('Failed to generate slide image', err);
                }
            }, 100);
        }
    };

    const selectedElement = elements.find(el => el.id === selectedId);

    // Helpers for toolbar
    const handleEmojiClick = (emoji) => {
        if (selectedElement && selectedElement.type === 'text') {
            updateElement(selectedElement.id, { content: selectedElement.content + emoji });
        } else {
            addElement('text', { content: emoji, fontSize: 100 });
        }
        setAnchorElEmoji(null);
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullScreen
            PaperProps={{
                sx: { bgcolor: '#121212', color: '#fff' }
            }}
        >
            <DialogTitle sx={{ borderBottom: 1, borderColor: 'rgba(255,255,255,0.1)', px: 3, py: 2 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="h6" fontWeight="bold">Slide Creator</Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                        <ZoomSilder scale={scale} setScale={setScale} />
                        <Button color="inherit" onClick={onClose} startIcon={<CloseIcon />}>Abbrechen</Button>
                        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>Speichern</Button>
                    </Stack>
                </Stack>
            </DialogTitle>

            <Stack direction="row" sx={{ height: 'calc(100vh - 65px)', overflow: 'hidden' }}>

                {/* LEFT TOOLBAR - INSERT */}
                <Paper square elevation={0} sx={{
                    width: 72,
                    borderRight: 1, borderColor: 'rgba(255,255,255,0.1)',
                    bgcolor: '#1e1e1e',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2, gap: 2,
                    overflowY: 'auto'
                }}>
                    <ToolbarButton icon={<TextFieldsIcon />} label="Text" onClick={() => addElement('text')} />

                    <label>
                        <input type="file" hidden accept="image/*" onChange={handleImageUpload} />
                        <ToolbarButton icon={<AddPhotoAlternateIcon />} label="Bild" onClick={() => { }} component="span" />
                    </label>

                    <ToolbarButton icon={<ImageIcon />} label="Logo" onClick={() => addElement('logo')} />
                    <ToolbarButton icon={<CheckBoxOutlineBlankIcon />} label="Rechteck" onClick={() => addElement('rect')} />
                    <ToolbarButton icon={<CircleOutlinedIcon />} label="Kreis" onClick={() => addElement('circle')} />
                    <ToolbarButton icon={<HorizontalRuleIcon />} label="Linie" onClick={() => addElement('line')} />
                    <ToolbarButton icon={<StarIcon />} label="Icon" onClick={() => addElement('icon', { iconName: 'star' })} />

                    <ToolbarButton
                        icon={<RestaurantMenuIcon />}
                        label="Menü"
                        onClick={() => setMenuDialogOpen(true)}
                        color="secondary"
                    />

                    <label>
                        <input type="file" hidden accept="image/*" onChange={handleBgUpload} />
                        <ToolbarButton icon={<WallpaperIcon />} label="Bg" onClick={() => { }} component="span" />
                    </label>
                </Paper>

                {/* CANVAS AREA */}
                <Box
                    ref={containerRef}
                    sx={{
                        flex: 1,
                        bgcolor: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'auto',
                        position: 'relative',
                        backgroundImage: 'radial-gradient(#333 1px, transparent 1px)',
                        backgroundSize: '20px 20px'
                    }}
                    onMouseDown={() => setSelectedId(null)}
                >
                    <Box
                        ref={canvasRef}
                        sx={{
                            width: 1920,
                            height: 1080,
                            bgcolor: bgColor,
                            ...(bgImage && { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }),
                            position: 'relative',
                            boxShadow: '0 0 50px rgba(0,0,0,0.5)',
                            transform: `scale(${scale})`,
                            transformOrigin: 'center',
                            flexShrink: 0,
                            overflow: 'hidden'
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {elements.map(el => (
                            <Rnd
                                key={el.id}
                                size={{ width: el.width, height: el.height }}
                                position={{ x: el.x, y: el.y }}
                                scale={scale}
                                onDragStop={(e, d) => updateElement(el.id, { x: d.x, y: d.y })}
                                onResizeStop={(e, direction, ref, delta, position) => {
                                    updateElement(el.id, {
                                        width: ref.style.width,
                                        height: ref.style.height,
                                        ...position
                                    });
                                }}
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    setSelectedId(el.id);
                                }}
                                bounds="parent"
                                dragHandleClassName={'drag-handle-' + el.id}
                                style={{
                                    border: selectedId === el.id ? '2px dashed #2196f3' : 'none',
                                    zIndex: el.zIndex,
                                    cursor: selectedId === el.id ? 'move' : 'pointer'
                                }}
                            >
                                <div className={`drag-handle-${el.id}`} style={{ width: '100%', height: '100%' }}>
                                    <SlideElement element={el} isEditor={true} />
                                </div>
                            </Rnd>
                        ))}
                    </Box>
                </Box>

                {/* RIGHT PROPERTY PANEL */}
                <Paper square elevation={0} sx={{
                    width: 320,
                    borderLeft: 1, borderColor: 'rgba(255,255,255,0.1)',
                    bgcolor: '#1e1e1e',
                    color: 'white',
                    display: 'flex', flexDirection: 'column',
                    overflowY: 'auto'
                }}>
                    <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="overline" color="text.secondary">EINSTELLUNGEN</Typography>
                        {selectedId && (
                            <IconButton size="small" color="error" onClick={handleDelete}>
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Box>

                    {!selectedElement ? (
                        <Box sx={{ p: 2 }}>
                            <Accordion disableGutters defaultExpanded sx={{ bgcolor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' } }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: 'white' }} />}>
                                    <Typography variant="body2" fontWeight="bold">Hintergrund</Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    <Stack spacing={2}>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>Farbe</Typography>
                                            <ColorPicker color={bgColor} onChange={setBgColor} fullWidth />
                                        </Box>
                                        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />
                                        <Box>
                                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>Bild</Typography>
                                            {bgImage ? (
                                                <Box sx={{ position: 'relative' }}>
                                                    <img src={bgImage} alt="bg" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)' }} />
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => setBgImage(null)}
                                                        sx={{ position: 'absolute', top: 5, right: 5, bgcolor: 'rgba(0,0,0,0.5)', color: 'white' }}
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Box>
                                            ) : (
                                                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>Kein Bild gewählt</Typography>
                                            )}
                                        </Box>
                                    </Stack>
                                </AccordionDetails>
                            </Accordion>
                        </Box>
                    ) : (
                        <Box>
                            {/* Transformations Accordion */}
                            <Accordion disableGutters defaultExpanded sx={{ bgcolor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' } }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: 'white' }} />}>
                                    <Typography variant="body2" fontWeight="bold">Transformation</Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    <Stack spacing={2}>
                                        <Stack direction="row" alignItems="center" spacing={2}>
                                            <Typography variant="caption" sx={{ width: 60 }} color="text.secondary">Rotation</Typography>
                                            <Slider
                                                size="small"
                                                min={0} max={360}
                                                value={selectedElement.rotation}
                                                onChange={(_, v) => updateElement(selectedElement.id, { rotation: v })}
                                                sx={{ flex: 1, color: 'primary.main' }}
                                            />
                                            <Typography variant="caption" sx={{ width: 30, textAlign: 'right' }}>{selectedElement.rotation}°</Typography>
                                        </Stack>
                                        <Stack direction="row" alignItems="center" spacing={2}>
                                            <Typography variant="caption" sx={{ width: 60 }} color="text.secondary">Ebene</Typography>
                                            <Stack direction="row" spacing={1}>
                                                <Tooltip title="Nach hinten">
                                                    <IconButton size="small" sx={{ border: '1px solid rgba(255,255,255,0.2)' }} onClick={() => updateElement(selectedElement.id, { zIndex: selectedElement.zIndex - 1 })}>
                                                        <FlipToBackIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Nach vorne">
                                                    <IconButton size="small" sx={{ border: '1px solid rgba(255,255,255,0.2)' }} onClick={() => updateElement(selectedElement.id, { zIndex: selectedElement.zIndex + 1 })}>
                                                        <FlipToFrontIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Stack>
                                        </Stack>
                                    </Stack>
                                </AccordionDetails>
                            </Accordion>

                            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />

                            {/* Content & Style */}
                            <Accordion disableGutters defaultExpanded sx={{ bgcolor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' } }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: 'white' }} />}>
                                    <Typography variant="body2" fontWeight="bold">Inhalt & Stil</Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    <Stack spacing={2}>

                                        {/* TEXT Input */}
                                        {selectedElement.type === 'text' && (
                                            <>
                                                <TextField
                                                    label="Text"
                                                    multiline
                                                    rows={2}
                                                    value={selectedElement.content}
                                                    onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                                                    variant="outlined"
                                                    size="small"
                                                    fullWidth
                                                    InputProps={{ style: { color: 'white', backgroundColor: 'rgba(255,255,255,0.05)' } }}
                                                    InputLabelProps={{ style: { color: '#aaa' } }}
                                                />
                                                <Button
                                                    size="small"
                                                    startIcon={<EmojiEmotionsIcon />}
                                                    onClick={(e) => setAnchorElEmoji(e.currentTarget)}
                                                    sx={{ alignSelf: 'flex-start' }}
                                                >
                                                    Emoji
                                                </Button>
                                            </>
                                        )}

                                        {/* MENU Category */}
                                        {selectedElement.type === 'menu' && (
                                            <FormControlWrapper label="Kategorie">
                                                <Select
                                                    value={selectedElement.content}
                                                    onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                                                    variant="outlined"
                                                    size="small"
                                                    fullWidth
                                                    sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.05)', '.MuiSvgIcon-root': { color: 'white' } }}
                                                >
                                                    {categories.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                                </Select>
                                            </FormControlWrapper>
                                        )}

                                        {/* FONT Controls */}
                                        {(selectedElement.type === 'text' || selectedElement.type === 'menu') && (
                                            <>
                                                <Stack direction="row" spacing={1}>
                                                    <Box sx={{ flex: 1 }}>
                                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Schriftart</Typography>
                                                        <Select
                                                            value={selectedElement.fontFamily}
                                                            onChange={(e) => updateElement(selectedElement.id, { fontFamily: e.target.value })}
                                                            variant="outlined"
                                                            size="small"
                                                            fullWidth
                                                            sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.05)', '.MuiSvgIcon-root': { color: 'white' } }}
                                                        >
                                                            {FONTS.map(f => <MenuItem key={f} value={f} style={{ fontFamily: f }}>{f}</MenuItem>)}
                                                        </Select>
                                                    </Box>
                                                    <Box sx={{ width: 80 }}>
                                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Größe</Typography>
                                                        <TextField
                                                            type="number"
                                                            size="small"
                                                            value={selectedElement.fontSize}
                                                            onChange={(e) => updateElement(selectedElement.id, { fontSize: Number(e.target.value) })}
                                                            variant="outlined"
                                                            InputProps={{ style: { color: 'white', backgroundColor: 'rgba(255,255,255,0.05)' } }}
                                                        />
                                                    </Box>
                                                </Stack>

                                                <Box>
                                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Formatierung</Typography>
                                                    <ToggleButtonGroup
                                                        value={[
                                                            selectedElement.fontWeight === 'bold' ? 'bold' : null,
                                                            selectedElement.fontStyle === 'italic' ? 'italic' : null,
                                                            selectedElement.textAlign
                                                        ].filter(Boolean)}
                                                        onChange={(e, formats) => {
                                                            // Handle alignment separately if needed or smarter logic, but simple toggle works for style
                                                            // Note: formats is array of all active values.
                                                            // We need to check clicked value? Material UI ToggleButton passes new value array.
                                                        }}
                                                        size="small"
                                                        exclusive={false}
                                                        sx={{ width: '100%' }}
                                                    >
                                                        <ToggleButton
                                                            value="bold"
                                                            sx={{ color: 'white', flex: 1, borderColor: 'rgba(255,255,255,0.2)' }}
                                                            selected={selectedElement.fontWeight === 'bold'}
                                                            onChange={() => updateElement(selectedElement.id, { fontWeight: selectedElement.fontWeight === 'bold' ? 'normal' : 'bold' })}
                                                        >
                                                            <FormatBoldIcon fontSize="small" />
                                                        </ToggleButton>
                                                        <ToggleButton
                                                            value="italic"
                                                            sx={{ color: 'white', flex: 1, borderColor: 'rgba(255,255,255,0.2)' }}
                                                            selected={selectedElement.fontStyle === 'italic'}
                                                            onChange={() => updateElement(selectedElement.id, { fontStyle: selectedElement.fontStyle === 'italic' ? 'normal' : 'italic' })}
                                                        >
                                                            <FormatItalicIcon fontSize="small" />
                                                        </ToggleButton>

                                                        {/* Alignment Group - Exclusive */}
                                                        <ToggleButton
                                                            value="left"
                                                            selected={selectedElement.textAlign === 'left' || !selectedElement.textAlign}
                                                            onClick={() => updateElement(selectedElement.id, { textAlign: 'left' })}
                                                            sx={{ color: 'white', flex: 1, borderColor: 'rgba(255,255,255,0.2)', ml: 2 }}
                                                        >
                                                            <FormatAlignLeftIcon fontSize="small" />
                                                        </ToggleButton>
                                                        <ToggleButton
                                                            value="center"
                                                            selected={selectedElement.textAlign === 'center'}
                                                            onClick={() => updateElement(selectedElement.id, { textAlign: 'center' })}
                                                            sx={{ color: 'white', flex: 1, borderColor: 'rgba(255,255,255,0.2)' }}
                                                        >
                                                            <FormatAlignCenterIcon fontSize="small" />
                                                        </ToggleButton>
                                                        <ToggleButton
                                                            value="right"
                                                            selected={selectedElement.textAlign === 'right'}
                                                            onClick={() => updateElement(selectedElement.id, { textAlign: 'right' })}
                                                            sx={{ color: 'white', flex: 1, borderColor: 'rgba(255,255,255,0.2)' }}
                                                        >
                                                            <FormatAlignRightIcon fontSize="small" />
                                                        </ToggleButton>
                                                    </ToggleButtonGroup>
                                                </Box>

                                                <Box>
                                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>Textfarbe</Typography>
                                                    <ColorPicker color={selectedElement.color} onChange={(c) => updateElement(selectedElement.id, { color: c })} fullWidth />
                                                </Box>
                                            </>
                                        )}

                                        {/* Handles Shapes/Lines/Icons Colors */}
                                        {(selectedElement.type === 'rect' || selectedElement.type === 'circle' || selectedElement.type === 'line' || selectedElement.type === 'icon') && (
                                            <Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>Farbe</Typography>
                                                <ColorPicker color={selectedElement.color} onChange={(c) => updateElement(selectedElement.id, { color: c })} fullWidth />
                                            </Box>
                                        )}

                                        {/* Icon Selector */}
                                        {selectedElement.type === 'icon' && (
                                            <FormControlWrapper label="Icon Typ">
                                                <Select
                                                    value={selectedElement.content}
                                                    onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                                                    variant="outlined"
                                                    size="small"
                                                    fullWidth
                                                    sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.05)', '.MuiSvgIcon-root': { color: 'white' } }}
                                                >
                                                    {ICONS.map(i => <MenuItem key={i.name} value={i.name}>{i.name}</MenuItem>)}
                                                </Select>
                                            </FormControlWrapper>
                                        )}

                                    </Stack>
                                </AccordionDetails>
                            </Accordion>
                        </Box>
                    )}
                </Paper>
            </Stack>

            {/* Menu Selection Dialog */}
            <Dialog open={menuDialogOpen} onClose={() => setMenuDialogOpen(false)}>
                <DialogTitle>Kategorie auswählen</DialogTitle>
                <DialogContent>
                    <List>
                        {categories.map(cat => (
                            <ListItem button key={cat} onClick={() => {
                                addElement('menu', { category: cat });
                                setMenuDialogOpen(false);
                            }}>
                                <ListItemText primary={cat} />
                            </ListItem>
                        ))}
                    </List>
                    {categories.length === 0 && <Typography sx={{ m: 2 }} color="text.secondary">Keine Kategorien gefunden.</Typography>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setMenuDialogOpen(false)}>Abbrechen</Button>
                </DialogActions>
            </Dialog>

            {/* Emoji Picker Popover */}
            <Popover
                open={Boolean(anchorElEmoji)}
                anchorEl={anchorElEmoji}
                onClose={() => setAnchorElEmoji(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
                <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, bgcolor: '#333' }}>
                    {EMOJIS.map(e => (
                        <Button key={e} sx={{ fontSize: '1.5rem', minWidth: 40 }} onClick={() => handleEmojiClick(e)}>
                            {e}
                        </Button>
                    ))}
                </Box>
            </Popover>

        </Dialog>
    );
}

const ToolbarButton = ({ icon, label, onClick, component, color = 'white' }) => (
    <Tooltip title={label} placement="right">
        <IconButton onClick={onClick} component={component} sx={{ color: color === 'secondary' ? 'secondary.main' : 'white', flexDirection: 'column', gap: 0.5 }}>
            {icon}
            <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>{label}</Typography>
        </IconButton>
    </Tooltip>
);

const ColorPicker = ({ color, onChange, fullWidth }) => (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ bgcolor: 'rgba(255,255,255,0.05)', p: 0.5, borderRadius: 1, border: '1px solid rgba(255,255,255,0.1)', width: fullWidth ? '100%' : 'auto' }}>
        <input
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            style={{
                border: 'none', width: 30, height: 30, cursor: 'pointer', backgroundColor: 'transparent', padding: 0
            }}
        />
        <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1 }}>{color}</Typography>
    </Stack>
);

const ZoomSilder = ({ scale, setScale }) => (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: 150 }}>
        <Typography variant="caption">-</Typography>
        <Slider
            size="small"
            min={0.2} max={1.5} step={0.1}
            value={scale}
            onChange={(_, v) => setScale(v)}
            sx={{ color: 'white' }}
        />
        <Typography variant="caption">+</Typography>
    </Stack>
);

const FormControlWrapper = ({ label, children }) => (
    <Box sx={{ width: '100%' }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>{label}</Typography>
        {children}
    </Box>
);
