import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import FavoriteIcon from '@mui/icons-material/Favorite';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import api from '../../services/api';

export const ICONS = [
    { name: 'star', icon: <StarIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'heart', icon: <FavoriteIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'warning', icon: <WarningIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'check', icon: <CheckCircleIcon sx={{ width: '100%', height: '100%' }} /> },
    { name: 'arrow', icon: <ArrowForwardIcon sx={{ width: '100%', height: '100%' }} /> },
];

const MenuRenderer = ({ categoryName, style, isEditor, fontSize, color }) => {
    const [articles, setArticles] = useState([]);

    useEffect(() => {
        const fetchArticles = async () => {
            try {
                const res = await api.get('/articles?includeInactive=false');
                if (res.data && res.data.articles) {
                    const filtered = res.data.articles.filter(a =>
                        a.category && a.category.toLowerCase() === categoryName.toLowerCase()
                    );
                    setArticles(filtered);
                }
            } catch (err) {
                console.error("Failed to load menu", err);
            }
        };
        fetchArticles();
    }, [categoryName, isEditor]);

    if (!articles.length) return (
        <Box style={{ ...style, border: isEditor ? '1px dashed grey' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography style={{ fontSize: fontSize * 0.5, color }}>Keine Artikel in "{categoryName}"</Typography>
        </Box>
    );

    return (
        <Box style={{ ...style, display: 'block', overflow: 'hidden' }}>
            {articles.map(article => (
                <Box key={article.id} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, borderBottom: `1px dotted ${color}`, pb: 0.5 }}>
                    <Typography variant="body1" sx={{ fontWeight: 'bold', fontSize: `${fontSize * 0.4}px`, color, fontFamily: 'inherit' }}>
                        {article.name}
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 'bold', fontSize: `${fontSize * 0.4}px`, color, fontFamily: 'inherit' }}>
                        {Number(article.price).toFixed(2).replace('.', ',')} €
                    </Typography>
                </Box>
            ))}
        </Box>
    );
};

export default function SlideElement({ element, isEditor = false }) {
    const style = {
        width: '100%',
        height: '100%',
        transform: `rotate(${element.rotation}deg)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: element.textAlign || 'center',
        color: element.color,
        fontSize: element.type === 'text' ? `${element.fontSize}px` : undefined,
        fontFamily: element.fontFamily,
        fontWeight: element.fontWeight,
        fontStyle: element.fontStyle,
        backgroundColor: element.type === 'rect' || element.type === 'circle' ? element.color : 'transparent',
        borderRadius: element.borderRadius || 0,
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none',
    };

    if (element.type === 'image') return <img src={element.content} alt="" style={{ ...style, objectFit: 'contain' }} />;

    if (element.type === 'icon') {
        const iconDef = ICONS.find(i => i.name === element.content);
        return <div style={style}>{iconDef ? iconDef.icon : <StarIcon />}</div>;
    }

    if (element.type === 'line') {
        return (
            <div style={{ ...style, display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '100%', height: 6, backgroundColor: element.color, borderRadius: 3 }}></div>
            </div>
        );
    }

    if (element.type === 'menu') {
        return (
            <MenuRenderer
                categoryName={element.content}
                style={style}
                isEditor={isEditor}
                fontSize={element.fontSize || 40}
                color={element.color}
            />
        );
    }

    return <div style={style}>{element.content}</div>;
}
